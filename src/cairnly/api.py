"""HTTP API.

POST /ask streams Server-Sent Events: each event is one line `data: {json}` followed by a blank
line, using the event shapes from answer.py. SSE is plain HTTP, so browsers, curl and proxies
all handle it, and the UI can show tokens as they arrive instead of waiting for the full answer.
"""

import json
from collections.abc import Iterator

import psycopg
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from cairnly.answer import answer
from cairnly.config import get_settings
from cairnly.db import connect
from cairnly.kb import get_kb, load_kbs
from cairnly.llm import get_llm
from cairnly.rewrite import MAX_TURNS
from cairnly.search import search, search_kb
from cairnly.syllabus import track_ids

app = FastAPI(title="cairnly", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3010"],  # the Next.js dev server in web/
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class Turn(BaseModel):
    """One earlier question and answer, sent back by the client for follow-up questions."""

    question: str = Field(min_length=1, max_length=2000)
    answer: str = Field(max_length=4000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    kb: str = "lessons"
    provider: str | None = Field(default=None, pattern="^(ollama|anthropic)$")
    history: list[Turn] = Field(default_factory=list, max_length=MAX_TURNS)
    track: str | None = None  # limit search to one syllabus track, e.g. "ai-engineering"

    @field_validator("track")
    @classmethod
    def _known_track(cls, value: str | None) -> str | None:
        if value is not None and value not in track_ids():
            raise ValueError(f"unknown track {value!r}")
        return value


@app.get("/livez")
def livez() -> dict:
    """Liveness: the process answers. No database call, so a database outage does not make
    the orchestrator restart healthy API containers in a loop."""
    return {"status": "ok"}


@app.get("/health")
def health() -> dict:
    """Readiness: the database is reachable. Counts are null before the first migrate, so a
    fresh deploy can become ready and then run its migrate + ingest job."""
    try:
        with connect() as conn:
            docs, chunks = conn.execute(
                "SELECT (SELECT count(*) FROM documents), (SELECT count(*) FROM chunks)"
            ).fetchone()
    except psycopg.errors.UndefinedTable:
        docs = chunks = None
    except psycopg.OperationalError as exc:
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return {"status": "ok", "documents": docs, "chunks": chunks}


@app.get("/kbs")
def list_kbs() -> list[dict]:
    return [{"name": kb.name, "title": kb.title, "notice": kb.notice}
            for kb in load_kbs().values()]


@app.get("/search")
def search_endpoint(q: str = Query(min_length=1, max_length=2000),
                    k: int = Query(default=6, ge=1, le=20),
                    kb: str | None = None, track: str | None = None) -> dict:
    knowledge_base = _kb_or_404(kb) if kb is not None else None
    if track is not None and track not in track_ids():
        raise HTTPException(status_code=422, detail=f"unknown track {track!r}")
    with connect() as conn:
        result = (search_kb(conn, q, knowledge_base, top_k=k, track=track) if knowledge_base
                  else search(conn, q, top_k=k, track=track))
    return {"top_similarity": result.top_similarity,
            "hits": [{"citation": h.citation, "url": h.url, "score": h.score,
                      "similarity": h.similarity, "text": h.text} for h in result.hits]}


@app.post("/ask")
def ask(req: AskRequest) -> StreamingResponse:
    _kb_or_404(req.kb)  # validate before the stream starts, so errors are real HTTP errors
    return StreamingResponse(_sse(req), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache"})


def _kb_or_404(name: str):
    try:
        return get_kb(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _sse(req: AskRequest) -> Iterator[str]:
    s, kb = get_settings(), get_kb(req.kb)
    with connect() as conn:
        events = answer(req.question,
                        lambda q: search_kb(conn, q, kb, top_k=s.top_k, track=req.track),
                        get_llm(req.provider), kb,
                        history=[turn.model_dump() for turn in req.history])
        try:
            for event in events:
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:  # the stream has started, so report errors in-band
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
