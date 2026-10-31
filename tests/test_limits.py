from cairnly.limits import DAY, AnswerSlots, RateLimiter, client_ip


class Clock:
    """A settable clock: tests move time instead of sleeping."""

    def __init__(self, t: float = 1_000 * DAY):  # midnight UTC of some day
        self.t = t

    def __call__(self) -> float:
        return self.t


def limiter(clock, per_minute=10, per_day=200, global_per_day=2000, max_keys=10_000):
    return RateLimiter(per_minute, per_day, global_per_day, now=clock, max_keys=max_keys)


def test_eleventh_request_in_a_minute_waits_for_the_next_minute():
    clock = Clock()
    rl = limiter(clock)
    clock.t += 15.2
    assert all(rl.check("1.2.3.4") is None for _ in range(10))
    assert rl.check("1.2.3.4") == 45  # 44.8 s left in the minute, rounded up
    assert rl.check("5.6.7.8") is None  # other clients are not affected
    clock.t += 45
    assert rl.check("1.2.3.4") is None  # new minute


def test_retry_after_is_at_least_one_second_at_the_window_edge():
    clock = Clock()
    rl = limiter(clock, per_minute=1)
    clock.t += 59.9
    assert rl.check("a") is None
    assert rl.check("a") == 1


def test_day_limit_reports_the_wait_until_midnight_utc():
    clock = Clock()
    rl = limiter(clock, per_minute=100, per_day=3)
    clock.t += 3_600  # 01:00 UTC
    assert all(rl.check("a") is None for _ in range(3))
    clock.t += 120  # a new minute does not help once the day is spent
    assert rl.check("a") == DAY - 3_720
    clock.t += DAY
    assert rl.check("a") is None


def test_global_cap_counts_answers_only_and_rejected_requests_are_not_counted():
    clock = Clock()
    rl = limiter(clock, global_per_day=2)
    assert rl.check("a", count_global=True) is None
    assert rl.check("b", count_global=True) is None
    assert rl.check("c", count_global=True) == DAY  # site-wide cap reached at midnight
    assert rl.check("c") is None  # a search does not use the answer cap
    assert rl.clients["c"].minute.count == 1  # the refused answer was not counted


def test_old_clients_are_pruned_so_memory_stays_bounded():
    clock = Clock()
    rl = limiter(clock, max_keys=5)
    for n in range(5):
        rl.check(f"old-{n}")
    clock.t += DAY  # yesterday's clients are stale now
    for n in range(2):
        rl.check(f"new-{n}")
    assert set(rl.clients) == {"new-0", "new-1"}


def test_forwarded_for_is_trusted_only_behind_the_proxy():
    forged = "6.6.6.6, 9.9.9.9"  # the client wrote the first entry, the proxy appended the last
    assert client_ip("10.0.0.5", forged, trust_proxy=True) == "9.9.9.9"
    assert client_ip("10.0.0.5", forged, trust_proxy=False) == "10.0.0.5"
    assert client_ip("10.0.0.5", None, trust_proxy=True) == "10.0.0.5"
    assert client_ip("10.0.0.5", " , ", trust_proxy=True) == "10.0.0.5"
    assert client_ip(None, None, trust_proxy=False) == "unknown"


def test_forged_left_entries_do_not_dodge_the_limit():
    rl = limiter(Clock(), per_minute=2)
    for fake in ("1.1.1.1", "2.2.2.2"):
        assert rl.check(client_ip("10.0.0.5", f"{fake}, 9.9.9.9", True)) is None
    assert rl.check(client_ip("10.0.0.5", "3.3.3.3, 9.9.9.9", True)) is not None


def test_answer_slots_turn_away_the_fifth_and_release_is_idempotent():
    slots = AnswerSlots(4)
    held = [slots.acquire() for _ in range(4)]
    assert all(held) and slots.acquire() is None
    held[0].release()
    held[0].release()  # a second release must not free a slot it does not hold
    again = slots.acquire()
    assert again is not None and slots.acquire() is None
