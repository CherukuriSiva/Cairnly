"""Call control: who may start a call, the budgets, and how each call ended.

Everything here is plain Python with an injectable clock, so the rules are tested without audio.

- **Idempotent start.** The browser sends a random key with each start. A retry with the same
  key (a timeout, a double click) gets the same call back, never a second one.
- **One call per conversation.** A new call on a conversation that already has one replaces it;
  the old one ends with the reason "replaced".
- **Budgets** (per UTC day, in memory, per server process like the API's rate limits): calls per
  client address, and the minutes of all calls together. The minute cap protects the GPU spend
  limit, so once it is spent starts are refused (and the status says unavailable).
  A call never gets more time than the budget has left.
- **Concurrency.** At most `max_calls` calls at once (one by default: one container, one GPU).
  A call that is still closing holds its place; a start then gets "closing" and retries once.
  A hang-up is the exception: it frees the place (and stops counting minutes) the moment it
  arrives, while the call's pipeline closes behind it.
  A call has exactly one socket: the first to present the token claims it; any other is
  refused. A start that never connects frees its place after `CONNECT_WINDOW_S`.
- **End reasons.** Each call records why it ended (first reason wins) and keeps it for an hour,
  so the browser can read it after the call.
"""

import asyncio
import hmac
import math
import secrets
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field

from cairnly.limits import DAY

END_REASONS = ("farewell", "idle", "max_duration", "hung_up", "replaced", "error")
MIN_CALL_S = 30  # less budget than this left: no new calls
CONNECT_WINDOW_S = 10  # a call that never connects is given up after this long
KEEP_ENDED_S = 3600  # an ended call's reason stays readable this long
BUSY_RETRY_S = 30
CLOSING_RETRY_S = 1


class VoiceUnavailable(Exception):
    """No call now. `reason`: off, busy, limit (this address), budget (the whole site)."""

    def __init__(self, reason: str, retry_after: int):
        super().__init__(reason)
        self.reason, self.retry_after = reason, retry_after


class CallClosing(VoiceUnavailable):
    """The only place is held by a call that is still hanging up; try again in a moment."""

    def __init__(self):
        super().__init__("closing", CLOSING_RETRY_S)


@dataclass
class Call:
    id: str
    conversation_id: str
    key: str
    ip: str
    transport: str
    token: str  # one-time secret the socket must present
    created_at: float
    max_seconds: int
    state: str = "starting"  # starting, connecting (its socket is claimed), live, closing, closed
    started_at: float | None = None
    ended_at: float | None = None
    end_reason: str | None = None
    deadline: float | None = None
    reply: dict | None = None  # the start route's answer, replayed for a retry with the same key
    # Set while a WebRTC start is still answering its offer: a retry with the same key waits
    # for that answer instead of opening a second peer connection (None: the start failed).
    pending: asyncio.Future | None = field(default=None, repr=False)
    hangup: Callable[[str], None] | None = field(default=None, repr=False)  # set by the session

    @property
    def active(self) -> bool:
        return self.state != "closed"

    def public(self) -> dict:
        """What GET /voice/calls/{id} shows: no address, no token, no conversation id."""
        duration = None
        if self.started_at is not None:
            duration = round((self.ended_at or time.time()) - self.started_at, 1)
        return {"call_id": self.id, "state": self.state, "end_reason": self.end_reason,
                "max_seconds": self.max_seconds, "duration_s": duration}


class CallBook:
    def __init__(self, *, enabled: bool = True, max_calls: int = 1, max_call_s: int = 300,
                 calls_per_ip_per_day: int = 10, minutes_per_day: int = 60,
                 now: Callable[[], float] = time.time):
        self.enabled, self.max_calls, self.max_call_s = enabled, max_calls, max_call_s
        self.calls_per_ip_per_day, self.budget_s = calls_per_ip_per_day, minutes_per_day * 60
        self.now = now
        self.calls: dict[str, Call] = {}
        self.by_key: dict[str, Call] = {}
        self.ip_calls: dict[str, int] = {}
        self.used_s = 0.0
        self.day = -1
        self._lock = threading.Lock()

    # -- reading -------------------------------------------------------------------------

    def status(self, ip: str) -> dict:
        """Whether a call could start now, for the microphone button."""
        with self._lock:
            self._tidy()
            try:
                # A call that is hanging up frees its place in a moment: the microphone stays.
                seconds = self._admit(ip, conversation_id=None, closing_frees=True)
            except VoiceUnavailable as exc:
                return {"available": False, "reason": exc.reason, "max_call_seconds": 0}
            return {"available": True, "reason": None, "max_call_seconds": seconds}

    def get(self, call_id: str) -> Call | None:
        with self._lock:
            self._tidy()
            return self.calls.get(call_id)

    def budget_left(self) -> float:
        with self._lock:
            self._tidy()
            return self._budget_left()

    # -- changing ------------------------------------------------------------------------

    def start(self, conversation_id: str, key: str, ip: str, transport: str) -> tuple[Call, bool]:
        """The call for this key (created: False) or a new one (created: True). Raises
        VoiceUnavailable or CallClosing. A call on the same conversation is replaced."""
        replaced: Call | None = None
        with self._lock:
            self._tidy()
            known = self.by_key.get(key)
            if known and known.active and known.conversation_id == conversation_id:
                return known, False
            seconds = self._admit(ip, conversation_id)
            now = self.now()
            for other in self.calls.values():
                if other.active and other.conversation_id == conversation_id:
                    replaced = other
            call = Call(id=str(uuid.uuid4()), conversation_id=conversation_id, key=key, ip=ip,
                        transport=transport, token=secrets.token_urlsafe(24), created_at=now,
                        max_seconds=seconds)
            self.calls[call.id] = call
            self.by_key[key] = call
            self.ip_calls[ip] = self.ip_calls.get(ip, 0) + 1
        if replaced is not None:
            self.end(replaced.id, "replaced")
        return call, True

    def claim_socket(self, call_id: str, token: str) -> Call | None:
        """The one socket a WebSocket call gets. Checks the token and marks the call
        "connecting" in one step, so a second socket with the same token (a double connect,
        a replayed link) finds it taken and is refused before it touches the call."""
        with self._lock:
            self._tidy()
            call = self.calls.get(call_id)
            if (call is None or call.transport != "websocket" or call.state != "starting"
                    or not hmac.compare_digest(call.token, token)):
                return None
            call.state = "connecting"
            return call

    def went_live(self, call_id: str) -> Call | None:
        """The caller connected: the clock starts now."""
        with self._lock:
            call = self.calls.get(call_id)
            if call is None or call.state not in ("starting", "connecting"):
                return None
            call.state, call.started_at = "live", self.now()
            call.deadline = call.started_at + call.max_seconds
            return call

    def closing(self, call_id: str, reason: str) -> None:
        """The call is hanging up (its goodbye may still be playing). Records the reason."""
        with self._lock:
            call = self.calls.get(call_id)
            if call is None or not call.active:
                return
            call.end_reason = call.end_reason or reason
            call.state = "closing"

    def end(self, call_id: str, reason: str) -> None:
        """Ask a call to end. A live call is told through its session, which then calls
        `finish`; a call with no session yet is finished at once."""
        with self._lock:
            call = self.calls.get(call_id)
            if call is None or not call.active:
                return
            call.end_reason = call.end_reason or reason
            hangup = call.hangup
        if hangup is not None:
            hangup(reason)
        else:
            self.finish(call_id, reason)

    def hang_up(self, call_id: str) -> None:
        """The caller hung up (End call, or the browser went away). The call's place and its
        minutes are released now, not once its pipeline has finished closing, so the next call
        can start at once and the closing seconds cost nothing. Its session, if it has one, is
        then told to close."""
        with self._lock:
            call = self.calls.get(call_id)
            hangup = call.hangup if call is not None and call.active else None
        self.finish(call_id, "hung_up")
        if hangup is not None:
            hangup("hung_up")

    def finish(self, call_id: str, reason: str) -> None:
        """The call is over: record its reason (first wins) and charge its minutes."""
        with self._lock:
            call = self.calls.get(call_id)
            if call is None or not call.active:
                return
            if reason not in END_REASONS:
                reason = "error"
            call.end_reason = call.end_reason or reason
            call.state, call.ended_at, call.hangup = "closed", self.now(), None
            if call.started_at is not None:
                self.used_s += max(0.0, call.ended_at - call.started_at)

    # -- rules ---------------------------------------------------------------------------

    def _admit(self, ip: str, conversation_id: str | None, closing_frees: bool = False) -> int:
        """The seconds a new call may last, or raise why there is none."""
        if not self.enabled:
            raise VoiceUnavailable("off", 3600)
        others = [c for c in self.calls.values()
                  if c.active and c.conversation_id != conversation_id
                  and not (closing_frees and c.state == "closing")]
        if len(others) >= self.max_calls:
            if any(c.state == "closing" for c in others):
                raise CallClosing()
            raise VoiceUnavailable("busy", BUSY_RETRY_S)
        if self.ip_calls.get(ip, 0) >= self.calls_per_ip_per_day:
            raise VoiceUnavailable("limit", self._until_tomorrow())
        left = self._budget_left()
        if left < MIN_CALL_S:
            raise VoiceUnavailable("budget", self._until_tomorrow())
        return int(min(self.max_call_s, left))

    def _budget_left(self) -> float:
        now = self.now()
        running = sum(now - c.started_at for c in self.calls.values()
                      if c.active and c.started_at is not None)
        return self.budget_s - self.used_s - running

    def _until_tomorrow(self) -> int:
        now = self.now()
        return max(1, math.ceil((int(now // DAY) + 1) * DAY - now))

    def _tidy(self) -> None:
        """Start a new budget day; give up calls that never connected; forget old ones."""
        now = self.now()
        today = int(now // DAY)
        if today != self.day:
            self.day, self.used_s, self.ip_calls = today, 0.0, {}
        for call in list(self.calls.values()):
            if (call.state in ("starting", "connecting")
                    and now - call.created_at > CONNECT_WINDOW_S):
                call.state, call.ended_at = "closed", now
                call.end_reason = call.end_reason or "error"
            if call.state == "closed" and now - (call.ended_at or now) > KEEP_ENDED_S:
                del self.calls[call.id]
                if self.by_key.get(call.key) is call:
                    del self.by_key[call.key]


class CallClock:
    """The timers of one live call: the "ending soon" notice, the hard end, and idle hang-up.
    `tick` is called about once a second; `busy` means someone is speaking or an answer is
    being looked up, which also counts as activity."""

    def __init__(self, started: float, max_seconds: int, idle_s: float, notice_s: float):
        self.deadline = started + max_seconds
        self.idle_s, self.notice_s = idle_s, notice_s
        self.last_activity = started
        self.noticed = False

    def activity(self, now: float) -> None:
        self.last_activity = now

    def seconds_left(self, now: float) -> int:
        return max(0, math.ceil(self.deadline - now))

    def tick(self, now: float, busy: bool) -> str | None:
        """None, or what to do now: "time_up", "notice" (once) or "idle"."""
        if busy:
            self.last_activity = now
        if now >= self.deadline:
            return "time_up"
        if not self.noticed and now >= self.deadline - self.notice_s:
            self.noticed = True
            return "notice"
        if not busy and now - self.last_activity >= self.idle_s:
            return "idle"
        return None
