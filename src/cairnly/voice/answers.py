"""Where the voice brain gets its answers: the cairnly API's /ask, the same route the text chat
uses. Calling it over HTTP (not importing answer.py) keeps every protection in one place: the
guard, the rate limits and answer slots, the confidence gate, the citations, and saving the turn
into the conversation (with channel "voice")."""

import json
from collections.abc import AsyncIterator
from typing import Protocol

import httpx

# The API's own first-token limit is 90 s; leave room for it to report in-band.
READ_TIMEOUT_S = 120


class AskFailed(Exception):
    """/ask refused before streaming. `kind`: rate (429), busy (503), gone (404, the
    conversation was deleted), http (anything else), network."""

    def __init__(self, kind: str, status: int | None = None):
        super().__init__(kind)
        self.kind, self.status = kind, status


class AnswerSource(Protocol):
    def ask(self, question: str, conversation_id: str,
            session_id: str) -> AsyncIterator[dict]: ...


def failure_for(status: int) -> str:
    return {429: "rate", 503: "busy", 404: "gone"}.get(status, "http")


class HttpAnswers:
    """Streams /ask events (the dicts from answer.py, plus `done.text` and `message_id`)."""

    def __init__(self, api_url: str, client: httpx.AsyncClient | None = None):
        self.api_url = api_url.rstrip("/")
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(10, read=READ_TIMEOUT_S))

    async def ask(self, question: str, conversation_id: str,
                  session_id: str) -> AsyncIterator[dict]:
        body = {"question": question, "conversation_id": conversation_id, "channel": "voice",
                "session_id": session_id}
        try:
            async with self.client.stream("POST", f"{self.api_url}/ask", json=body) as res:
                if res.status_code != 200:
                    raise AskFailed(failure_for(res.status_code), res.status_code)
                async for line in res.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    try:
                        event = json.loads(line[6:])
                    except json.JSONDecodeError:
                        continue
                    if isinstance(event, dict) and isinstance(event.get("type"), str):
                        yield event
        except httpx.HTTPError as exc:
            raise AskFailed("network") from exc

    async def close(self) -> None:
        await self.client.aclose()
