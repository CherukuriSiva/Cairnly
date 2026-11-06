"""The voice server end to end with fake speech: a real HTTP server in a thread, a WebSocket
client that sends PCM "speech" (loud noise) and silence, the fake VAD, scripted speech to text,
a tone for text to speech, and fake answers instead of the API. No models, no network."""

import asyncio
import dataclasses
import json
import socket
import threading
import time

import pytest

pytest.importorskip("pipecat")  # the voice extra

import httpx  # noqa: E402
import numpy as np  # noqa: E402
import uvicorn  # noqa: E402
from websockets.asyncio.client import connect  # noqa: E402
from websockets.exceptions import InvalidStatus  # noqa: E402

from cairnly.limits import RateLimiter  # noqa: E402
from cairnly.voice import server, speech  # noqa: E402
from cairnly.voice.answers import AskFailed  # noqa: E402
from cairnly.voice.calls import CallBook  # noqa: E402
from cairnly.voice.models import fake_services  # noqa: E402

CONV = "44444444-4444-4444-8444-444444444444"
CHUNK = 640  # 20 ms of 16 kHz 16-bit audio
ORIGIN = server.api_settings.cors_origins[0]  # the site; browsers always send it on a socket
asked: list[dict] = []


ANSWER = ["RAG retrieves lesson text first [1]. ", "Then the model writes ", "an answer from it."]
LONG_ANSWER = [f"This is sentence number {n} of a long answer about retrieval. " for n in range(12)]


class FakeAnswers:
    def __init__(self, fail: str | None = None, pieces: list[str] = ANSWER):
        self.fail, self.pieces = fail, pieces

    async def ask(self, question, conversation_id, session_id):
        asked.append({"question": question, "conversation_id": conversation_id})
        if self.fail:
            raise AskFailed(self.fail)
        yield {"type": "sources", "sources": []}
        for piece in self.pieces:
            await asyncio.sleep(0.01)
            yield {"type": "token", "text": piece}
        yield {"type": "done", "refused": False, "text": "...", "message_id": 42}


def noise(seconds: float) -> list[bytes]:
    samples = (np.random.default_rng(1).uniform(-0.5, 0.5, int(16000 * seconds)) * 32767)
    pcm = samples.astype(np.int16).tobytes()
    return [pcm[i:i + CHUNK] for i in range(0, len(pcm), CHUNK)]


def silence(seconds: float) -> list[bytes]:
    return [bytes(CHUNK)] * int(seconds / 0.02)


@pytest.fixture
def voice(monkeypatch):
    """The voice app on a free port, with fresh budgets and fake services."""
    settings = dataclasses.replace(server.settings, max_call_s=60, idle_s=60, ending_notice_s=5,
                                   transports=("websocket", "webrtc"))
    monkeypatch.setattr(server, "settings", settings)
    monkeypatch.setattr(server, "book", CallBook(max_calls=1, max_call_s=60,
                                                 calls_per_ip_per_day=20, minutes_per_day=10))
    monkeypatch.setattr(server, "starts", RateLimiter(50, 1000, 10**6))
    monkeypatch.setattr(server, "services", fake_services(
        ["What is RAG?", "goodbye"], seconds_per_char=0.004))
    monkeypatch.setattr(server, "answers_factory", FakeAnswers)
    asked.clear()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    config = uvicorn.Config(server.app, host="127.0.0.1", port=port, log_level="warning",
                            lifespan="off")
    srv = uvicorn.Server(config)
    thread = threading.Thread(target=srv.run, daemon=True)
    thread.start()
    while not srv.started:
        time.sleep(0.01)
    yield f"127.0.0.1:{port}", settings
    srv.should_exit = True
    thread.join(5)


def start(base: str, key: str = "key-00000001", **body) -> httpx.Response:
    return httpx.post(f"http://{base}/voice/calls",
                      json={"conversation_id": CONV, "key": key, **body})


async def events_until(ws, kind: str, seen: list[dict], timeout: float = 10) -> dict:
    """Read messages (skipping audio) until one of `kind` arrives."""
    deadline = time.monotonic() + timeout
    while True:
        message = await asyncio.wait_for(ws.recv(), deadline - time.monotonic())
        if isinstance(message, bytes):
            seen.append({"kind": "audio", "bytes": len(message)})
            continue
        event = json.loads(message)
        seen.append(event)
        if event["kind"] == kind:
            return event


async def say(ws, chunks: list[bytes]) -> None:
    for chunk in chunks:
        await ws.send(chunk)
        await asyncio.sleep(0.02)


def test_status_and_start_are_idempotent(voice):
    base, _ = voice
    status = httpx.get(f"http://{base}/voice/status").json()
    assert status["available"] is True and status["max_call_seconds"] == 60
    assert status["transports"] == ["websocket", "webrtc"]
    first = start(base)
    assert first.status_code == 200
    again = start(base)
    assert again.json() == first.json()  # the same key never opens a second call
    assert first.json()["socket_path"].startswith(f"/voice/calls/{first.json()['call_id']}")
    other = httpx.post(f"http://{base}/voice/calls", json={
        "conversation_id": "55555555-5555-4555-8555-555555555555", "key": "key-00000002"})
    assert other.status_code == 503 and other.headers["retry-after"]
    assert other.json()["detail"] == server.UNAVAILABLE


def test_bad_requests(voice):
    base, _ = voice
    assert start(base, conversation_id="not-a-uuid").status_code == 422
    assert start(base, transport="webrtc").status_code == 422  # no offer
    assert httpx.get(f"http://{base}/voice/calls/{CONV}").status_code == 404


def test_a_wrong_token_cannot_join_or_end_a_call(voice):
    base, _ = voice
    call = start(base).json()

    async def join():
        url = f"ws://{base}/voice/calls/{call['call_id']}/socket?token=nope"
        async with connect(url, origin=ORIGIN) as ws:
            await ws.recv()

    with pytest.raises(InvalidStatus) as refused:  # closed before the handshake: HTTP 403
        asyncio.run(join())
    assert refused.value.response.status_code == 403
    end = httpx.post(f"http://{base}/voice/calls/{call['call_id']}/end", json={"token": "x" * 10})
    assert end.status_code == 404


def test_a_socket_needs_the_site_origin(voice):
    base, _ = voice
    call = start(base).json()

    async def join(**origin):
        async with connect(f"ws://{base}{call['socket_path']}", **origin) as ws:
            await ws.recv()

    for origin in ({}, {"origin": "https://elsewhere.example"}):  # none (not a browser), foreign
        with pytest.raises(InvalidStatus) as refused:
            asyncio.run(join(**origin))
        assert refused.value.response.status_code == 403
    assert server.book.get(call["call_id"]).state == "starting"  # still free for the browser


def test_a_second_socket_for_the_same_call_is_refused(voice):
    """Two sockets with one token, at the same moment: one call, one session, and the second
    socket is turned away before it can touch the call (no ghost call outside the limits)."""
    base, _ = voice
    call = start(base).json()
    url = f"ws://{base}{call['socket_path']}"
    seen: list[dict] = []
    refused: list[int] = []

    async def join(ws_holder: list):
        try:
            ws_holder.append(await connect(url, origin=ORIGIN))
        except InvalidStatus as exc:
            refused.append(exc.response.status_code)

    async def run():
        held: list = []
        await asyncio.gather(join(held), join(held))
        assert refused == [403] and len(held) == 1
        ws = held[0]
        await events_until(ws, "call.ready", seen)
        assert len(server.sessions) == 1
        await ws.send(json.dumps({"kind": "call.hangup"}))
        assert (await events_until(ws, "call.closed", seen))["reason"] == "hung_up"
        await ws.close()

    asyncio.run(run())
    assert sum(1 for c in server.book.calls.values()) == 1
    assert server.book.ip_calls == {"127.0.0.1": 1}


def test_a_call_answers_a_spoken_question_and_hangs_up(voice):
    base, _ = voice
    call = start(base).json()
    seen: list[dict] = []

    async def run():
        async with connect(f"ws://{base}{call['socket_path']}", origin=ORIGIN) as ws:
            ready = await events_until(ws, "call.ready", seen)
            assert ready["max_seconds"] == 60
            greeting = await events_until(ws, "caption.bot", seen)
            assert greeting["text"] == speech.GREETING
            await say(ws, silence(0.3) + noise(0.5) + silence(0.6))
            heard = await events_until(ws, "caption.user", seen)
            assert heard["text"] == "What is RAG?"
            assert (await events_until(ws, "caption.bot", seen))["text"] == speech.HOLDING
            assert (await events_until(ws, "caption.bot", seen))["text"] == (
                "RAG retrieves lesson text first.")
            # Saved as soon as the answer ends: before its sentences have all been spoken.
            assert {"kind": "turn.saved", "message_id": 42} in seen
            await events_until(ws, "caption.bot", seen)  # the second sentence
            await ws.send(json.dumps({"kind": "call.hangup"}))
            closed = await events_until(ws, "call.closed", seen)
            assert closed["reason"] == "hung_up"

    asyncio.run(run())
    assert asked == [{"question": "What is RAG?", "conversation_id": CONV}]
    assert any(e["kind"] == "audio" for e in seen)  # the bot's audio came as binary frames
    final = httpx.get(f"http://{base}/voice/calls/{call['call_id']}").json()
    for _ in range(50):
        if final["state"] == "closed":
            break
        time.sleep(0.05)
        final = httpx.get(f"http://{base}/voice/calls/{call['call_id']}").json()
    assert final["state"] == "closed" and final["end_reason"] == "hung_up"


def test_goodbye_ends_the_call_with_a_farewell(voice, monkeypatch):
    base, _ = voice
    monkeypatch.setattr(server, "services", fake_services(["bye now"], seconds_per_char=0.004))
    call = start(base).json()
    seen: list[dict] = []

    async def run():
        async with connect(f"ws://{base}{call['socket_path']}", origin=ORIGIN) as ws:
            await events_until(ws, "caption.bot", seen)
            await say(ws, noise(0.4) + silence(0.6))
            assert (await events_until(ws, "caption.bot", seen))["text"] == speech.FAREWELL
            assert (await events_until(ws, "call.closed", seen))["reason"] == "farewell"

    asyncio.run(run())
    assert asked == []  # a goodbye is not a question


def test_barge_in_clears_the_bot_audio(voice, monkeypatch):
    base, _ = voice
    # A slow voice, so the greeting is still playing when the caller talks over it.
    monkeypatch.setattr(server, "services", fake_services(["What is RAG?"], seconds_per_char=0.1))
    call = start(base).json()
    seen: list[dict] = []

    async def run():
        async with connect(f"ws://{base}{call['socket_path']}", origin=ORIGIN) as ws:
            await events_until(ws, "caption.bot", seen)
            await asyncio.sleep(0.5)
            await say(ws, noise(0.4))
            await events_until(ws, "audio.clear", seen)
            await ws.send(json.dumps({"kind": "call.hangup"}))
            await events_until(ws, "call.closed", seen)

    asyncio.run(run())


def test_api_failure_is_spoken_plainly(voice, monkeypatch):
    base, _ = voice
    monkeypatch.setattr(server, "answers_factory", lambda: FakeAnswers(fail="rate"))
    call = start(base).json()
    seen: list[dict] = []

    async def run():
        async with connect(f"ws://{base}{call['socket_path']}", origin=ORIGIN) as ws:
            await events_until(ws, "caption.bot", seen)
            await say(ws, noise(0.4) + silence(0.6))
            await events_until(ws, "caption.user", seen)
            await events_until(ws, "caption.bot", seen)  # the holding line
            assert (await events_until(ws, "caption.bot", seen))["text"] == speech.TOO_MANY
            await ws.send(json.dumps({"kind": "call.hangup"}))
            await events_until(ws, "call.closed", seen)

    asyncio.run(run())


def test_idle_and_time_limits_end_the_call(voice, monkeypatch):
    base, settings = voice
    monkeypatch.setattr(server, "settings", dataclasses.replace(settings, idle_s=1))
    call = start(base).json()
    seen: list[dict] = []

    async def run():
        async with connect(f"ws://{base}{call['socket_path']}", origin=ORIGIN) as ws:
            assert (await events_until(ws, "call.closed", seen))["reason"] == "idle"

    asyncio.run(run())
    assert speech.IDLE in [e.get("text") for e in seen]

    server.book.max_call_s = 6  # 6 s calls, "ending soon" 5 s before the end
    monkeypatch.setattr(server, "settings", dataclasses.replace(settings, idle_s=60))
    call = start(base, key="key-00000002").json()
    seen.clear()

    async def run_long():
        async with connect(f"ws://{base}{call['socket_path']}", origin=ORIGIN) as ws:
            ending = await events_until(ws, "call.ending", seen)
            assert 0 < ending["seconds_left"] <= 5
            assert (await events_until(ws, "call.closed", seen, timeout=15))["reason"] == (
                "max_duration")

    asyncio.run(run_long())


def test_a_second_call_on_the_conversation_replaces_the_first(voice):
    base, _ = voice
    first = start(base).json()
    seen: list[dict] = []

    async def run():
        async with connect(f"ws://{base}{first['socket_path']}", origin=ORIGIN) as ws:
            await events_until(ws, "call.ready", seen)
            second = start(base, key="key-00000002")
            assert second.status_code == 200
            assert (await events_until(ws, "call.closed", seen))["reason"] == "replaced"

    asyncio.run(run())


def test_hanging_up_mid_answer_ends_the_call_at_once(voice, monkeypatch):
    base, _ = voice
    # A long answer in a slow voice: it would take about 40 s to play out.
    monkeypatch.setattr(server, "services", fake_services(["What is RAG?"], seconds_per_char=0.05))
    monkeypatch.setattr(server, "answers_factory", lambda: FakeAnswers(pieces=LONG_ANSWER))
    call = start(base).json()
    seen: list[dict] = []

    async def run():
        async with connect(f"ws://{base}{call['socket_path']}", origin=ORIGIN) as ws:
            await events_until(ws, "caption.bot", seen)  # the greeting starts
            await say(ws, noise(0.4) + silence(0.6))
            await events_until(ws, "caption.user", seen)
            await events_until(ws, "caption.bot", seen)  # the holding line
            await events_until(ws, "caption.bot", seen)  # the answer starts playing
            await ws.send(json.dumps({"kind": "call.hangup"}))
            assert (await events_until(ws, "call.closed", seen))["reason"] == "hung_up"
            await asyncio.sleep(0.5)  # the browser waits for the server to close, then closes

    asyncio.run(run())
    deadline = time.monotonic() + 3  # nowhere near the time the queued speech would take
    while server.book.get(call["call_id"]).state != "closed":
        assert time.monotonic() < deadline, "the call is still closing"
        time.sleep(0.05)
