import pytest

from cairnly.limits import DAY
from cairnly.voice.calls import (
    MIN_CALL_S,
    CallBook,
    CallClock,
    CallClosing,
    VoiceUnavailable,
)

CONV_A = "11111111-1111-4111-8111-111111111111"
CONV_B = "22222222-2222-4222-8222-222222222222"


class Clock:
    def __init__(self, t: float = 10 * DAY + 1000):
        self.t = t

    def __call__(self) -> float:
        return self.t


def book(clock, **kw):
    return CallBook(now=clock, **{"max_calls": 1, "max_call_s": 300, "calls_per_ip_per_day": 3,
                                  "minutes_per_day": 10, **kw})


def test_same_key_returns_the_same_call():
    b = book(Clock())
    first, created = b.start(CONV_A, "key-0001", "1.1.1.1", "websocket")
    again, created_again = b.start(CONV_A, "key-0001", "1.1.1.1", "websocket")
    assert created and not created_again and again is first
    assert b.ip_calls["1.1.1.1"] == 1  # a retry is not a second call


def test_new_call_on_the_same_conversation_replaces_the_old_one():
    b = book(Clock())
    ended: list[str] = []
    old, _ = b.start(CONV_A, "key-0001", "1.1.1.1", "websocket")
    old.hangup = ended.append  # a live session is told to end
    new, created = b.start(CONV_A, "key-0002", "1.1.1.1", "websocket")
    assert created and new.id != old.id
    assert ended == ["replaced"] and old.end_reason == "replaced"
    b.finish(old.id, "hung_up")  # what the session reports later does not change the reason
    assert b.get(old.id).public()["end_reason"] == "replaced"


def test_one_call_at_a_time_and_closing_is_retryable():
    clock = Clock()
    b = book(clock)
    a, _ = b.start(CONV_A, "key-0001", "1.1.1.1", "websocket")
    b.went_live(a.id)
    with pytest.raises(VoiceUnavailable) as busy:
        b.start(CONV_B, "key-0002", "2.2.2.2", "websocket")
    assert busy.value.reason == "busy" and not isinstance(busy.value, CallClosing)
    assert b.status("2.2.2.2")["available"] is False
    b.closing(a.id, "hung_up")
    with pytest.raises(CallClosing):
        b.start(CONV_B, "key-0003", "2.2.2.2", "websocket")
    b.finish(a.id, "hung_up")
    assert b.start(CONV_B, "key-0004", "2.2.2.2", "websocket")[1]


def test_calls_per_address_per_day():
    clock = Clock()
    b = book(clock, max_calls=5)
    for n in range(3):
        call, _ = b.start(f"3333333{n}-3333-4333-8333-333333333333", f"key-000{n}", "9.9.9.9",
                          "websocket")
        b.finish(call.id, "hung_up")
    with pytest.raises(VoiceUnavailable) as limit:
        b.start(CONV_A, "key-0009", "9.9.9.9", "websocket")
    assert limit.value.reason == "limit"
    assert b.status("8.8.8.8")["available"] is True  # another address still may
    clock.t += DAY  # a new day resets the count
    assert b.start(CONV_A, "key-0010", "9.9.9.9", "websocket")[1]


def test_daily_minutes_cap_shortens_and_then_stops_calls():
    clock = Clock()
    b = book(clock, minutes_per_day=6, calls_per_ip_per_day=10)
    call, _ = b.start(CONV_A, "key-0001", "1.1.1.1", "websocket")
    b.went_live(call.id)
    clock.t += 200
    b.finish(call.id, "hung_up")
    # 360 s budget - 200 s used: the next call may last 160 s, not 300.
    nxt, _ = b.start(CONV_B, "key-0002", "1.1.1.1", "websocket")
    assert nxt.max_seconds == 160
    b.went_live(nxt.id)
    clock.t += 160 - MIN_CALL_S + 1
    assert b.status("2.2.2.2")["available"] is False  # the live call is spending the rest
    b.finish(nxt.id, "max_duration")
    assert b.status("2.2.2.2") == {"available": False, "reason": "budget", "max_call_seconds": 0}


def test_unconnected_call_is_given_up_and_end_reason_is_kept():
    clock = Clock()
    b = book(clock)
    call, _ = b.start(CONV_A, "key-0001", "1.1.1.1", "websocket")
    clock.t += 31
    assert b.get(call.id).public()["end_reason"] == "error"
    assert b.status("1.1.1.1")["available"] is True
    clock.t += 3601
    assert b.get(call.id) is None  # forgotten after an hour


def test_turned_off():
    b = CallBook(enabled=False, now=Clock())
    assert b.status("1.1.1.1")["reason"] == "off"


def test_unknown_reason_is_an_error():
    b = book(Clock())
    call, _ = b.start(CONV_A, "key-0001", "1.1.1.1", "websocket")
    b.finish(call.id, "whatever")
    assert call.end_reason == "error"


def test_call_clock():
    clock = CallClock(started=0, max_seconds=100, idle_s=45, notice_s=30)
    assert clock.tick(10, busy=False) is None
    assert clock.tick(44, busy=False) is None
    assert clock.tick(45, busy=False) == "idle"
    clock.activity(45)
    assert clock.tick(69, busy=True) is None  # someone is talking: never idle
    assert clock.tick(70, busy=False) == "notice"
    assert clock.tick(71, busy=False) is None  # the notice comes once
    assert clock.seconds_left(71) == 29
    assert clock.tick(100, busy=True) == "time_up"
