"""The brain's /ask client, against a fake HTTP transport (no API needed)."""

import asyncio
import json

import httpx
import pytest

from cairnly.voice.answers import AskFailed, HttpAnswers

CONV = "44444444-4444-4444-8444-444444444444"


def collect(handler) -> list[dict]:
    async def run():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        answers = HttpAnswers("http://api.test/", client)
        return [e async for e in answers.ask("What is RAG?", CONV, "call-12345")]

    return asyncio.run(run())


def test_streams_events_and_sends_a_voice_turn():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"], seen["body"] = str(request.url), json.loads(request.content)
        body = ('data: {"type": "token", "text": "Hi"}\n\n'
                ": a comment\n\ndata: not json\n\n"
                'data: {"type": "done", "refused": false, "message_id": 3}\n\n')
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    events = collect(handler)
    assert [e["type"] for e in events] == ["token", "done"]
    assert seen["url"] == "http://api.test/ask"
    assert seen["body"] == {"question": "What is RAG?", "conversation_id": CONV,
                            "channel": "voice", "session_id": "call-12345"}


@pytest.mark.parametrize("status,kind", [(429, "rate"), (503, "busy"), (404, "gone"),
                                         (500, "http")])
def test_refusals_before_the_stream(status, kind):
    with pytest.raises(AskFailed) as failed:
        collect(lambda request: httpx.Response(status, json={"detail": "no"}))
    assert failed.value.kind == kind


def test_network_failure():
    def handler(request):
        raise httpx.ConnectError("down")

    with pytest.raises(AskFailed) as failed:
        collect(handler)
    assert failed.value.kind == "network"
