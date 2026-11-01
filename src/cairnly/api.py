"""HTTP API.

POST /ask streams Server-Sent Events: each event is one line `data: {json}` followed by a blank
line, using the event shapes from answer.py. SSE is plain HTTP, so browsers, curl and proxies
all handle it, and the UI can show tokens as they arrive instead of waiting for the full answer.

The API is public, so every request that can reach the model is limited before the stream
starts (limits.py): a 403 for a provider this server does not allow, a 429 with Retry-After
over a rate limit, and a 503 when all answer slots are busy. Once the stream has started,
errors are reported in-band with a generic message, so internal details never reach the client.

A client that goes away mid-answer: Starlette reads a sync generator in a worker thread and
never closes it, so the abandoned answer would hold its model stream, its database connection
and its answer slot until garbage collection found it. AnswerStream therefore closes the
generator itself when the response ends, however it ends (finished, client gone, error), and
then frees the slot. A generator cannot be closed in the middle of a step, so the cleanup waits
for the step that is running to end: the next model piece while the answer streams, or at worst
that step's own time limit (a follow-up's rewrite or the first token 90 s, the query
embedding 120 s per read). Until then the model request is still open, so its slot stays held,
which is the right count.
"""

import json
import time
from collections.abc import Iterator
from contextlib import asynccontextmanager, closing

import anyio
import psycopg
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from starlette.types import Receive, Scope, Send

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
CLOSE_RETRY_S = 0.05  # how often to retry closing a generator that is mid-step in a worker

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
        return AnswerStream(_sse(req, slot), slot)
    except BaseException:
        slot.release()
        raise


class AnswerStream(StreamingResponse):
    """The /ask event stream. When the response ends, however it ends, the generator is closed
    (which closes the model stream and the database connection) and then the answer slot is
    freed, even when the generator never started. The close waits for the step that is
    running to end, which that step's time limit bounds (see finish_stream)."""

    def __init__(self, events: Iterator[str], slot: Slot):
        super().__init__(events, media_type="text/event-stream",
                         headers={"Cache-Control": "no-cache"})
        self.events, self.slot = events, slot

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            # Shielded: a cancelled request must still clean up. In a worker thread, because
            # closing runs the generator's cleanup, which does blocking I/O.
            with anyio.CancelScope(shield=True):
                await anyio.to_thread.run_sync(finish_stream, self.events, self.slot)


def finish_stream(events: Iterator[str], slot: Slot) -> None:
    """Close the event generator, then free its slot. A generator still running a step in
    another worker thread cannot be closed yet (ValueError), so retry until that step yields;
    every step is bounded by the time limits in answer.py."""
    try:
        while True:
            try:
                getattr(events, "close", lambda: None)()
                return
            except ValueError:  # "generator already executing"
                time.sleep(CLOSE_RETRY_S)
    finally:
        slot.release()


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
