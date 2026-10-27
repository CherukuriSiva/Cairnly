"""HTTP API.

POST /ask streams Server-Sent Events: each event is one line `data: {json}` followed by a blank
line, using the event shapes from answer.py. SSE is plain HTTP, so browsers, curl and proxies
all handle it, and the UI can show tokens as they arrive instead of waiting for the full answer.
"""

import json
from collections.abc import Iterator

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from cairnly.answer import answer
from cairnly.config import get_settings
from cairnly.db import connect
from cairnly.llm import get_llm
from cairnly.search import search

app = FastAPI(title="cairnly", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3010"],  # the Next.js dev server in web/
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    provider: str | None = Field(default=None, pattern="^(ollama|anthropic)$")


@app.get("/health")
def health() -> dict:
    with connect() as conn:
        docs, chunks = conn.execute(
            "SELECT (SELECT count(*) FROM documents), (SELECT count(*) FROM chunks)").fetchone()
    return {"status": "ok", "documents": docs, "chunks": chunks}


@app.get("/search")
def search_endpoint(q: str = Query(min_length=1, max_length=2000),
                    k: int = Query(default=6, ge=1, le=20)) -> dict:
    with connect() as conn:
        result = search(conn, q, top_k=k)
    return {"top_similarity": result.top_similarity,
            "hits": [{"citation": h.citation, "score": h.score, "similarity": h.similarity,
                      "text": h.text} for h in result.hits]}


@app.post("/ask")
def ask(req: AskRequest) -> StreamingResponse:
    return StreamingResponse(_sse(req), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache"})


def _sse(req: AskRequest) -> Iterator[str]:
    s = get_settings()
    with connect() as conn:
        events = answer(req.question, lambda q: search(conn, q, top_k=s.top_k),
                        get_llm(req.provider), s.min_score)
        try:
            for event in events:
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:  # the stream has started, so report errors in-band
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
