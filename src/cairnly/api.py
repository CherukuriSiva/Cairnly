"""HTTP API.

POST /ask streams Server-Sent Events: each event is one line `data: {json}` followed by a blank
line, using the event shapes from answer.py. SSE is plain HTTP, so browsers, curl and proxies
all handle it, and the UI can show tokens as they arrive instead of waiting for the full answer.

The API is public, so every request that can reach the model is limited before the stream
starts (limits.py): a 403 for a provider this server does not allow, a 429 with Retry-After
over a rate limit, and a 503 when all answer slots are busy. Once the stream has started,
errors are reported in-band with a generic message, so internal details never reach the client.
"""

import json
from collections.abc import Iterator
from contextlib import asynccontextmanager, closing

import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from starlette.background import BackgroundTask

from cairnly import tracing
from cairnly.answer import answer
from cairnly.config import get_settings
from cairnly.db import connect
from cairnly.kb import get_kb, load_kbs
from cairnly.limits import AnswerSlots, RateLimiter, Slot, client_ip
from cairnly.llm import ProviderDisabled, available_providers, check_provider, get_llm
from cairnly.rewrite import MAX_TURNS
from cairnly.search import search, search_kb
from cairnly.syllabus import track_ids

BUSY = "Too many answers are being written right now. Please try again in a few seconds."
BUSY_RETRY_S = 5
RATE_LIMITED = "Too many requests. Please wait and try again."
STREAM_ERROR = "Something went wrong while writing the answer."

# Read at import, so a misconfigured production server (Claude allowed) fails at boot.
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    tracing.shutdown()  # send the last buffered traces before the process exits


app = FastAPI(title="cairnly", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),  # the Next.js dev server in web/ by default
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
    expose_headers=["Retry-After"],  # the chat reads it to say how long to wait
)

# Per process; tests replace these with fresh ones.
limiter = RateLimiter(settings.rate_limit_per_minute, settings.rate_limit_per_day,
                      settings.global_answers_per_day)
slots = AnswerSlots(settings.max_concurrent_answers)


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
    # A random id per browser tab, so a trace viewer can group follow-ups. Not a user id.
    session_id: str | None = Field(default=None, pattern="^[A-Za-z0-9-]{8,64}$")

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


@app.get("/config")
def config() -> dict:
    """What the chat may offer: the providers this server allows and the default one."""
    s = get_settings()
    return {"providers": available_providers(s), "default_provider": s.llm_provider}


@app.get("/kbs")
def list_kbs() -> list[dict]:
    return [{"name": kb.name, "title": kb.title, "notice": kb.notice}
            for kb in load_kbs().values()]


@app.get("/search")
def search_endpoint(request: Request, q: str = Query(min_length=1, max_length=2000),
                    k: int = Query(default=6, ge=1, le=20),
                    kb: str | None = None, track: str | None = None) -> dict:
    knowledge_base = _kb_or_404(kb) if kb is not None else None
    if track is not None and track not in track_ids():
        raise HTTPException(status_code=422, detail=f"unknown track {track!r}")
    _rate_limit(request, answer=False)  # search embeds the query on the GPU too
    with connect() as conn:
        result = (search_kb(conn, q, knowledge_base, top_k=k, track=track) if knowledge_base
                  else search(conn, q, top_k=k, track=track))
    return {"top_similarity": result.top_similarity,
            "hits": [{"citation": h.citation, "url": h.url, "score": h.score,
                      "similarity": h.similarity, "text": h.text} for h in result.hits]}


@app.post("/ask")
def ask(req: AskRequest, request: Request) -> StreamingResponse:
    # Validate and limit before the stream starts, so these are real HTTP errors.
    _kb_or_404(req.kb)
    try:
        check_provider(req.provider)
    except ProviderDisabled as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    _rate_limit(request, answer=True)
    slot = slots.acquire()
    if slot is None:
        raise HTTPException(status_code=503, detail=BUSY,
                            headers={"Retry-After": str(BUSY_RETRY_S)})
    try:
        # The slot is released by the stream's `finally` and, in case the stream never
        # starts, by the background task; release() is idempotent.
        return StreamingResponse(_sse(req, slot), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache"},
                                 background=BackgroundTask(slot.release))
    except BaseException:
        slot.release()
        raise


def _rate_limit(request: Request, *, answer: bool) -> None:
    ip = client_ip(request.client.host if request.client else None,
                   request.headers.get("x-forwarded-for"), get_settings().trust_proxy)
    wait = limiter.check(ip, count_global=answer)
    if wait is not None:
        raise HTTPException(status_code=429, detail=RATE_LIMITED,
                            headers={"Retry-After": str(wait)})


def _kb_or_404(name: str):
    try:
        return get_kb(name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _sse(req: AskRequest, slot: Slot) -> Iterator[str]:
    try:
        s, kb = get_settings(), get_kb(req.kb)
        with connect() as conn:
            events = answer(req.question,
                            lambda q: search_kb(conn, q, kb, top_k=s.top_k, track=req.track),
                            get_llm(req.provider), kb,
                            history=[turn.model_dump() for turn in req.history],
                            session_id=req.session_id, track=req.track)
            # closing(): when the client goes away, answer() is closed too and can mark its
            # trace instead of waiting for garbage collection.
            with closing(events):
                try:
                    for event in events:
                        yield f"data: {json.dumps(event)}\n\n"
                except Exception:  # the stream has started, so report errors in-band
                    yield f"data: {json.dumps({'type': 'error', 'message': STREAM_ERROR})}\n\n"
    finally:
        slot.release()
