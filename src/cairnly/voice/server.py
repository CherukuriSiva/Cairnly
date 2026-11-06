"""The voice server's HTTP routes (`cairnly voice-serve`, or the cairnly-voice Modal app).

    GET  /voice/status                 can a call start now? {available, reason, max_call_seconds,
                                       transports, half_duplex}; asked after a click on the mic,
                                       never on page load (any request wakes the GPU)
    POST /voice/calls                  start a call (idempotent per key; see calls.py). WebSocket:
                                       returns where to connect. WebRTC: send the SDP offer,
                                       get the answer.
    WS   /voice/calls/{id}/socket      the call's audio and events (WebSocket transport)
    GET  /voice/calls/{id}             the call's state and, once over, why it ended
    POST /voice/calls/{id}/end         hang up (also works when the socket is already gone)

Errors: 503 with Retry-After when voice is unavailable (off, busy, a limit or the daily minutes
spent), 409 with Retry-After while the previous call is still closing, 429 for too many starts.
The browser origin must be in CORS_ORIGINS, for the routes and the socket alike; a socket with
no Origin header is refused, and so is a second socket for a call that already has one.
"""

import asyncio
import hmac
import logging
import re
import sys
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Path, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from cairnly import conversations, tracing
from cairnly.config import get_settings
from cairnly.limits import RateLimiter, client_ip
from cairnly.voice.answers import HttpAnswers
from cairnly.voice.calls import CallBook, CallClosing, VoiceUnavailable
from cairnly.voice.models import SpeechServices, services_for
from cairnly.voice.settings import get_voice_settings

log = logging.getLogger("cairnly.voice")

UNAVAILABLE = "Voice isn't available right now."
CLOSING = "The last call is still closing."
TOO_MANY = "Too many calls started. Please wait and try again."
NOT_FOUND = "Call not found."

# Pipecat logs through loguru, at DEBUG by default, and some of its lines quote what is said
# ("Generating TTS [...]", "TTS request: ... - text", "not speaking [...]"). Captions are not
# stored anywhere (PRIVACY.md), logs included: keep INFO and up, minus any line that quotes.
QUOTING_LINES = re.compile(
    r"Generating TTS \[|TTS request:|not speaking \[|Error parsing JSON message")


def _no_speech(record) -> bool:
    return QUOTING_LINES.search(record["message"]) is None


def quiet_pipecat_logs() -> None:
    """Replace loguru's default DEBUG handler. Runs at import, before any pipeline exists,
    whatever starts the app (`cairnly voice-serve` or Modal)."""
    from loguru import logger

    logger.remove()
    logger.add(lambda line: sys.stderr.write(line), level="INFO", filter=_no_speech)


quiet_pipecat_logs()
settings = get_voice_settings()
api_settings = get_settings()

# Per process; tests replace these.
book = CallBook(enabled=settings.enabled, max_calls=settings.max_calls,
                max_call_s=settings.max_call_s, calls_per_ip_per_day=settings.calls_per_ip_per_day,
                minutes_per_day=settings.minutes_per_day)
starts = RateLimiter(settings.starts_per_ip_per_minute, 1000, 10**9)
services: SpeechServices | None = None
answers_factory = lambda: HttpAnswers(settings.api_url)  # noqa: E731 - tests replace it
sessions: set[asyncio.Task] = set()


def speech_services() -> SpeechServices:
    global services
    if services is None:
        services = services_for(settings)
    return services


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not log.handlers:  # the per-turn timings and call endings, next to Uvicorn's own log
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
        log.addHandler(handler)
        log.setLevel(logging.INFO)
    if settings.enabled:
        await asyncio.to_thread(speech_services)  # load the models before the first call
    yield
    for task in list(sessions):
        task.cancel()
    tracing.shutdown()


app = FastAPI(title="cairnly-voice", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(api_settings.cors_origins),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
    expose_headers=["Retry-After"],
)

CallId = Path(pattern=conversations.UUID4)


class Offer(BaseModel):
    sdp: str = Field(min_length=10, max_length=20_000)
    type: Literal["offer"]


class StartRequest(BaseModel):
    conversation_id: str = Field(pattern=conversations.UUID4)
    key: str = Field(pattern="^[A-Za-z0-9-]{8,64}$")  # the browser's idempotency key
    transport: Literal["websocket", "webrtc"] = "websocket"
    offer: Offer | None = None


class EndRequest(BaseModel):
    token: str = Field(min_length=8, max_length=64)


def _ip(request: Request | WebSocket) -> str:
    return client_ip(request.client.host if request.client else None,
                     request.headers.get("x-forwarded-for"), api_settings.trust_proxy)


@app.get("/livez")
def livez() -> dict:
    return {"status": "ok"}


@app.get("/voice/status")
def status(request: Request) -> dict:
    return {**book.status(_ip(request)), "transports": list(settings.transports),
            "half_duplex": settings.half_duplex, "ice_servers": list(settings.stun_urls)}


@app.post("/voice/calls")
async def start_call(body: StartRequest, request: Request) -> dict:
    if body.transport not in settings.transports:
        raise HTTPException(status_code=422, detail=f"transport {body.transport} is turned off")
    if body.transport == "webrtc" and body.offer is None:
        raise HTTPException(status_code=422, detail="a WebRTC call needs an SDP offer")
    ip = _ip(request)
    wait = starts.check(ip)
    if wait is not None:
        raise HTTPException(status_code=429, detail=TOO_MANY, headers={"Retry-After": str(wait)})
    try:
        call, created = book.start(body.conversation_id, body.key, ip, body.transport)
    except CallClosing as exc:
        raise HTTPException(status_code=409, detail=CLOSING,
                            headers={"Retry-After": str(exc.retry_after)}) from exc
    except VoiceUnavailable as exc:
        raise HTTPException(status_code=503, detail=UNAVAILABLE,
                            headers={"Retry-After": str(exc.retry_after)}) from exc
    if not created:  # the same key again: the same call, never a second one
        if call.reply is not None:
            return call.reply
        if call.pending is not None:  # its WebRTC answer is still being made: wait for it
            reply = await asyncio.shield(call.pending)
            if reply is None:
                raise HTTPException(status_code=502, detail=UNAVAILABLE)
            return reply
    reply = {"call_id": call.id, "token": call.token, "transport": call.transport,
             "max_seconds": call.max_seconds}
    if call.transport == "websocket":
        reply["socket_path"] = f"/voice/calls/{call.id}/socket?token={call.token}"
    else:
        # Marked before the first await, so a retry that arrives meanwhile waits for this one.
        call.pending = asyncio.get_running_loop().create_future()
        try:
            reply["answer"] = await _start_webrtc(call, body.offer)
        except Exception as exc:
            call.pending.set_result(None)
            book.finish(call.id, "error")
            log.exception("WebRTC setup failed")
            raise HTTPException(status_code=502, detail=UNAVAILABLE) from exc
        call.pending.set_result(reply)
    call.reply = reply
    return reply


@app.get("/voice/calls/{call_id}")
def read_call(call_id: str = CallId) -> dict:
    call = book.get(call_id)
    if call is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return call.public()


@app.post("/voice/calls/{call_id}/end", status_code=202)
def end_call(body: EndRequest, call_id: str = CallId) -> dict:
    call = book.get(call_id)
    if call is None or not hmac.compare_digest(call.token, body.token):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    book.end(call_id, "hung_up")
    return call.public()


@app.websocket("/voice/calls/{call_id}/socket")
async def call_socket(websocket: WebSocket, call_id: str, token: str = "") -> None:
    # Browsers always send Origin on a WebSocket; a socket without one is not from the site.
    origin = websocket.headers.get("origin")
    allowed = list(api_settings.cors_origins)
    # The token is checked and the call claimed in one step, before the socket is accepted:
    # a second socket for the same call is refused and never touches it.
    call = book.claim_socket(call_id, token) if origin in allowed else None
    if call is None:
        await websocket.close(code=1008)  # policy violation: no such call for this caller
        return
    from cairnly.voice.session import CallSession, websocket_transport

    await websocket.accept()
    session = CallSession(call, book, settings, speech_services(), answers_factory())
    task = asyncio.current_task()
    sessions.add(task)
    try:
        await session.run(websocket_transport(websocket, allowed))
    finally:
        sessions.discard(task)


async def _start_webrtc(call, offer: Offer) -> dict:
    """Answer the browser's offer and run the call in the background."""
    from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection

    from cairnly.voice.session import CallSession, webrtc_transport

    connection = SmallWebRTCConnection(ice_servers=list(settings.stun_urls))
    await connection.initialize(sdp=offer.sdp, type=offer.type)
    session = CallSession(call, book, settings, speech_services(), answers_factory())
    task = asyncio.create_task(session.run(webrtc_transport(connection)))
    sessions.add(task)
    task.add_done_callback(sessions.discard)
    answer = connection.get_answer()
    if answer is None:
        raise RuntimeError("no SDP answer")
    return {"sdp": answer["sdp"], "type": answer["type"]}
