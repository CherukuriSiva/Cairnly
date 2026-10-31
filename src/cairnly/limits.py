"""Abuse limits for the public API: request rates per client, a site-wide daily cap, and a cap
on answers being written at the same time.

Every answer costs GPU time, so a stranger with a script must not be able to run up the bill
or crowd everyone else out. Fixed windows (per UTC minute and per UTC day) are the simplest
limit to explain and to test: a client gets N requests in the current minute, and the answer
to "when can I try again?" is "when the window rolls over".

The counters live in memory, per API process. With several API tasks the effective caps are
per task (ADR 0014); a shared store is not worth it for a free demo. The clock is injectable,
so tests move time instead of sleeping.
"""

import math
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

MINUTE, DAY = 60, 86_400
MAX_KEYS = 10_000  # prune old per-client counters once there are more clients than this


@dataclass
class _Window:
    """A request count inside one fixed window (window id = seconds since epoch // size)."""

    size: int
    id: int = -1
    count: int = 0

    def roll(self, now: float) -> None:
        current = int(now // self.size)
        if current != self.id:  # a new window: forget the old count
            self.id, self.count = current, 0

    def retry_after(self, now: float) -> int:
        """Whole seconds until this window ends, at least 1."""
        return max(1, math.ceil((self.id + 1) * self.size - now))


@dataclass
class _Client:
    minute: _Window
    day: _Window


class RateLimiter:
    """Per-client minute and day limits plus an optional site-wide daily cap."""

    def __init__(self, per_minute: int, per_day: int, global_per_day: int,
                 now: Callable[[], float] = time.time, max_keys: int = MAX_KEYS):
        self.per_minute, self.per_day, self.global_per_day = per_minute, per_day, global_per_day
        self.now, self.max_keys = now, max_keys
        self.clients: dict[str, _Client] = {}
        self.site = _Window(DAY)
        self._prune_at = max_keys
        self._lock = threading.Lock()

    def check(self, client: str, *, count_global: bool = False) -> int | None:
        """Count one request from `client` and return None, or return the seconds to wait
        (Retry-After) without counting it when a limit is reached. `count_global` also applies
        the site-wide daily cap (answers only)."""
        with self._lock:
            now = self.now()
            entry = self.clients.get(client) or _Client(_Window(MINUTE), _Window(DAY))
            entry.minute.roll(now)
            entry.day.roll(now)
            over = [w.retry_after(now) for w, limit in
                    ((entry.minute, self.per_minute), (entry.day, self.per_day))
                    if w.count >= limit]
            if over:
                return max(over)  # waiting for the minute is no use when the day is spent
            if count_global:
                self.site.roll(now)
                if self.site.count >= self.global_per_day:
                    return self.site.retry_after(now)
                self.site.count += 1
            entry.minute.count += 1
            entry.day.count += 1
            self.clients[client] = entry
            if len(self.clients) > self._prune_at:
                self._prune(now)
            return None

    def _prune(self, now: float) -> None:
        """Drop clients whose counts belong to past days; they would be reset on next use."""
        today = int(now // DAY)
        self.clients = {k: v for k, v in self.clients.items() if v.day.id == today}
        # If today alone has many clients, wait until the dict doubles before scanning again.
        self._prune_at = max(self.max_keys, 2 * len(self.clients))


def client_ip(peer: str | None, forwarded_for: str | None, trust_proxy: bool) -> str:
    """The address to rate-limit.

    Behind our one proxy (the ALB, or the cluster ingress) the real client is the LAST
    X-Forwarded-For entry: the proxy appends it. Everything to its left was sent by the client
    and can be forged, so it is never used. Without TRUST_PROXY the header is ignored, because
    then anyone could send it straight to the API.
    """
    if trust_proxy and forwarded_for:
        entries = [e.strip() for e in forwarded_for.split(",") if e.strip()]
        if entries:
            return entries[-1]
    return peer or "unknown"


class Slot:
    """One held answer slot. `release()` is safe to call more than once."""

    def __init__(self, semaphore: threading.BoundedSemaphore):
        self._semaphore, self._held = semaphore, True
        self._lock = threading.Lock()

    def release(self) -> None:
        with self._lock:
            if self._held:
                self._held = False
                self._semaphore.release()


class AnswerSlots:
    """At most `size` answers are written at once; the next one is turned away, not queued."""

    def __init__(self, size: int):
        self._semaphore = threading.BoundedSemaphore(size)

    def acquire(self) -> Slot | None:
        if not self._semaphore.acquire(blocking=False):
            return None
        return Slot(self._semaphore)
