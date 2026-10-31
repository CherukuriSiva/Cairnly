import json

import pytest
from fastapi.testclient import TestClient

from cairnly import api
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
