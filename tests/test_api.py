import json

import pytest
from fastapi.testclient import TestClient

from cairnly import api
from cairnly.limits import AnswerSlots, RateLimiter
from cairnly.search import Hit, SearchResult

HIT = Hit(1, "What is RAG", "rag.md", "Idea", 1, 4, "Retrieve then generate.", 0.03, 0.9)


class FakeLLM:
    name = "fake/llm"

    def stream(self, system, prompt):
        yield "Answer [1]."


class FakeConn:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        class Rows:
            def fetchone(self):
                return (3, 40)
        return Rows()


calls: list[dict] = []


@pytest.fixture(autouse=True)
def fresh_limits(monkeypatch):
    """Every test starts with empty rate-limit counters and all answer slots free."""
    monkeypatch.setattr(api, "limiter", RateLimiter(10, 200, 2000))
    monkeypatch.setattr(api, "slots", AnswerSlots(4))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(api, "connect", lambda: FakeConn())
    calls.clear()

    def fake_search_kb(conn, q, kb, top_k=6, track=None):
        calls.append({"q": q, "track": track})
        return SearchResult([HIT], 0.9)

    monkeypatch.setattr(api, "search",
                        lambda conn, q, top_k=6, kb=None, track=None: SearchResult([HIT], 0.9))
    monkeypatch.setattr(api, "search_kb", fake_search_kb)
    monkeypatch.setattr(api, "get_llm", lambda provider=None: FakeLLM())
    return TestClient(api.app)


def test_health_reports_counts(client):
    assert client.get("/health").json() == {"status": "ok", "documents": 3, "chunks": 40}


def test_search_returns_citations(client):
    body = client.get("/search", params={"q": "rag"}).json()
    assert body["hits"][0]["citation"] == "What is RAG > Idea (rag.md:1-4)"


def test_ask_streams_server_sent_events(client):
    resp = client.post("/ask", json={"question": "What is RAG?"})

    assert resp.headers["content-type"].startswith("text/event-stream")
    events = [json.loads(line[6:]) for line in resp.text.splitlines() if line.startswith("data: ")]
    assert [e["type"] for e in events] == ["sources", "token", "done"]
    assert events[1]["text"] == "Answer [1]."


def test_ask_validates_input(client):
    assert client.post("/ask", json={"question": ""}).status_code == 422
    assert client.post("/ask", json={"question": "q", "provider": "gpt"}).status_code == 422
    assert client.post("/ask", json={"question": "q", "kb": "nope"}).status_code == 404


def test_ask_validates_history_and_track(client):
    turn = {"question": "What is RAG?", "answer": "Retrieval then generation."}
    ok = client.post("/ask", json={"question": "q", "history": [turn] * 6, "track": "dsa"})
    assert ok.status_code == 200
    too_many = client.post("/ask", json={"question": "q", "history": [turn] * 7})
    assert too_many.status_code == 422
    long_answer = {"question": "q", "answer": "x" * 4001}
    assert client.post("/ask", json={"question": "q", "history": [long_answer]}).status_code == 422
    long_question = {"question": "x" * 2001, "answer": ""}
    assert client.post("/ask", json={"question": "q", "history": [long_question]}).status_code \
        == 422
    assert client.post("/ask", json={"question": "q", "track": "cooking"}).status_code == 422


def test_ask_passes_the_track_to_search(client):
    client.post("/ask", json={"question": "What is RAG?", "track": "ai-engineering"})
    assert calls[-1]["track"] == "ai-engineering"


def test_search_track_is_validated_and_hits_carry_urls(client):
    assert client.get("/search", params={"q": "x", "track": "nope"}).status_code == 422
    body = client.get("/search", params={"q": "x", "track": "dsa"}).json()
    assert "url" in body["hits"][0]


def test_kbs_lists_configured_knowledge_bases(client):
    names = [kb["name"] for kb in client.get("/kbs").json()]
    assert names == ["lessons"]
    assert client.get("/search", params={"q": "x", "kb": "nope"}).status_code == 404


def test_livez_needs_no_database(monkeypatch):
    def boom():
        raise AssertionError("livez must not touch the database")

    monkeypatch.setattr(api, "connect", boom)
    assert TestClient(api.app).get("/livez").json() == {"status": "ok"}


def test_health_before_first_migrate_is_ready_with_null_counts(monkeypatch):
    import psycopg

    class NoTables(FakeConn):
        def execute(self, sql, params=None):
            raise psycopg.errors.UndefinedTable("relation documents does not exist")

    monkeypatch.setattr(api, "connect", lambda: NoTables())
    body = TestClient(api.app).get("/health").json()
    assert body == {"status": "ok", "documents": None, "chunks": None}


def test_health_is_503_when_the_database_is_down(monkeypatch):
    import psycopg

    def down():
        raise psycopg.OperationalError("connection refused")

    monkeypatch.setattr(api, "connect", down)
    assert TestClient(api.app).get("/health").status_code == 503


def _events(resp):
    return [json.loads(line[6:]) for line in resp.text.splitlines() if line.startswith("data: ")]


def _free_slots() -> int:
    held = [s for s in (api.slots.acquire() for _ in range(5)) if s]
    for slot in held:
        slot.release()
    return len(held)


ASK = {"question": "What is RAG?"}


def test_config_lists_only_ollama_by_default(client, monkeypatch, fresh_settings):
    monkeypatch.delenv("ALLOW_ANTHROPIC", raising=False)
    fresh_settings()
    assert client.get("/config").json() == {"providers": ["ollama"], "default_provider": "ollama"}

    monkeypatch.setenv("ALLOW_ANTHROPIC", "true")
    fresh_settings()
    assert client.get("/config").json()["providers"] == ["ollama", "anthropic"]


def test_claude_is_403_when_turned_off(client, monkeypatch, fresh_settings):
    monkeypatch.delenv("ALLOW_ANTHROPIC", raising=False)
    fresh_settings()
    resp = client.post("/ask", json={**ASK, "provider": "anthropic"})
    assert resp.status_code == 403
    assert resp.json() == {"detail": "The Claude API is turned off on this server."}


def test_eleventh_request_in_a_minute_is_429_with_retry_after(client):
    for _ in range(5):
        assert client.post("/ask", json=ASK).status_code == 200
        assert client.get("/search", params={"q": "rag"}).status_code == 200
    resp = client.post("/ask", json=ASK)
    assert resp.status_code == 429
    assert 1 <= int(resp.headers["retry-after"]) <= 60
    assert client.get("/search", params={"q": "rag"}).status_code == 429
    assert client.get("/config").status_code == 200  # not limited
    assert client.get("/kbs").status_code == 200


def test_forged_forwarded_for_cannot_dodge_the_limit(client, monkeypatch, fresh_settings):
    monkeypatch.setenv("TRUST_PROXY", "1")
    fresh_settings()
    for n in range(10):
        headers = {"X-Forwarded-For": f"10.0.0.{n}, 203.0.113.7"}
        assert client.post("/ask", json=ASK, headers=headers).status_code == 200
    forged = {"X-Forwarded-For": "10.9.9.9, 203.0.113.7"}
    assert client.post("/ask", json=ASK, headers=forged).status_code == 429
    other = {"X-Forwarded-For": "203.0.113.8"}  # a different real client behind the proxy
    assert client.post("/ask", json=ASK, headers=other).status_code == 200


def test_forwarded_for_is_ignored_without_trust_proxy(client, monkeypatch, fresh_settings):
    monkeypatch.delenv("TRUST_PROXY", raising=False)
    fresh_settings()
    for n in range(10):
        headers = {"X-Forwarded-For": f"203.0.113.{n}"}
        assert client.post("/ask", json=ASK, headers=headers).status_code == 200
    resp = client.post("/ask", json=ASK, headers={"X-Forwarded-For": "203.0.113.99"})
    assert resp.status_code == 429


def test_global_daily_cap_applies_to_answers(client, monkeypatch):
    monkeypatch.setattr(api, "limiter", RateLimiter(10, 200, 1))
    assert client.post("/ask", json=ASK).status_code == 200
    assert client.post("/ask", json=ASK).status_code == 429
    assert client.get("/search", params={"q": "rag"}).status_code == 200


def test_fifth_concurrent_answer_is_503(client):
    held = [api.slots.acquire() for _ in range(4)]
    resp = client.post("/ask", json=ASK)
    assert resp.status_code == 503 and resp.headers["retry-after"] == "5"
    assert "Too many answers" in resp.json()["detail"]
    for slot in held:
        slot.release()


def test_slots_come_back_after_normal_streams(client):
    for _ in range(6):
        assert [e["type"] for e in _events(client.post("/ask", json=ASK))][-1] == "done"
    assert _free_slots() == 4


def test_a_failing_llm_gets_a_generic_error_and_frees_its_slot(client, monkeypatch):
    class Broken(FakeLLM):
        def stream(self, system, prompt):
            raise RuntimeError("connect to http://ollama.internal:11434 failed")
            yield

    monkeypatch.setattr(api, "get_llm", lambda provider=None: Broken())
    events = _events(client.post("/ask", json=ASK))
    assert events[-1] == {"type": "error", "message": api.STREAM_ERROR}
    assert "ollama.internal" not in json.dumps(events)
    assert _free_slots() == 4


def test_a_stream_closed_early_frees_its_slot(client):
    slot = api.slots.acquire()
    stream = api._sse(api.AskRequest(**ASK), slot)
    next(stream)  # sources sent, then the client goes away
    stream.close()
    assert _free_slots() == 4


def test_a_stream_that_never_starts_frees_its_slot_in_the_background(client):
    import asyncio

    from starlette.requests import Request

    request = Request({"type": "http", "method": "POST", "headers": [],
                       "client": ("198.51.100.1", 5000)})
    resp = api.ask(api.AskRequest(**ASK), request)
    assert _free_slots() == 3
    asyncio.run(resp.background())
    assert _free_slots() == 4


def test_session_id_must_match_the_pattern(client):
    assert client.post("/ask", json={**ASK, "session_id": "4f2c9a1e-1b2c-4d5e"}).status_code \
        == 200
    for bad in ("short", "has spaces in it", "x" * 65, "semi;colon-1234"):
        assert client.post("/ask", json={**ASK, "session_id": bad}).status_code == 422


def test_cors_exposes_retry_after():
    resp = TestClient(api.app).options("/ask", headers={
        "Origin": "http://localhost:3010", "Access-Control-Request-Method": "POST"})
    assert resp.headers["access-control-allow-origin"] == "http://localhost:3010"
    simple = TestClient(api.app).get("/livez", headers={"Origin": "http://localhost:3010"})
    assert "retry-after" in simple.headers["access-control-expose-headers"].lower()
