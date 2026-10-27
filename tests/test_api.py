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


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(api, "connect", lambda: FakeConn())
    monkeypatch.setattr(api, "search", lambda conn, q, top_k=6: SearchResult([HIT], 0.9))
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
