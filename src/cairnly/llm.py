"""LLM providers behind one tiny interface: `stream(system, prompt)` yields text pieces.

The rest of the app never imports a vendor SDK, so switching between Ollama and the Claude API
is one setting (LLM_PROVIDER), and tests use a fake that yields fixed text. After a stream
ends, `usage` holds the token counts the provider reported (None when it reported none), so
traces can show cost per answer.

Claude is local only: `get_llm("anthropic")` raises ProviderDisabled unless ALLOW_ANTHROPIC is
set, and config.py refuses that setting on a production server.

Time limits (`time_limited`): a read timeout alone cannot bound an answer, because it restarts
with every piece, so a model that sends one word every 80 seconds never times out. The limits
are therefore wall-clock: a helper thread reads the stream into a queue, and the caller waits
on the queue only for the time left. When time runs out the caller gets ModelTooSlow at once;
the helper thread stops reading at its next piece, or at the HTTP read timeout if the model
has gone silent, and closes the stream so the model stops generating.
"""

import json
import queue
import threading
import time
from collections.abc import Iterator
from typing import Protocol

import httpx

from cairnly.config import Settings, get_settings
from cairnly.ollama import ollama_client

PROVIDERS = ("ollama", "anthropic")
DISABLED_MESSAGE = "The Claude API is turned off on this server."


class ProviderDisabled(Exception):
    """The requested provider exists but this server does not allow it."""


class ModelTooSlow(Exception):
    """The model missed a time limit; `started` says whether any text had arrived."""

    def __init__(self, started: bool):
        super().__init__("answer timeout" if started else "first token timeout")
        self.started = started


_PIECE, _END, _ERROR = "piece", "end", "error"


def time_limited(stream: Iterator[str], first_s: float, rest_s: float | None = None
                 ) -> Iterator[str]:
    """The pieces of `stream`, or ModelTooSlow when the first piece takes longer than `first_s`
    or the rest takes longer than `rest_s` after it. Without `rest_s` the whole stream must
    finish within `first_s`. Closing this generator stops the stream too."""
    pieces: queue.Queue = queue.Queue()
    stop = threading.Event()

    def pump() -> None:
        try:
            for piece in stream:
                pieces.put((_PIECE, piece))
                if stop.is_set():
                    break
            pieces.put((_END, None))
        except Exception as exc:  # handed to the caller, which raises it
            pieces.put((_ERROR, exc))
        finally:
            getattr(stream, "close", lambda: None)()  # stop the model generating

    threading.Thread(target=pump, name="llm-stream", daemon=True).start()
    deadline, started = time.monotonic() + first_s, False
    try:
        while True:
            try:
                kind, value = pieces.get(timeout=max(0.0, deadline - time.monotonic()))
            except queue.Empty:
                raise ModelTooSlow(started) from None
            if kind == _END:
                return
            if kind == _ERROR:
                raise value
            if not started and rest_s is not None:
                deadline = time.monotonic() + rest_s
            started = True
            yield value
    finally:
        stop.set()


class LLM(Protocol):
    name: str
    usage: dict | None  # {"input": n, "output": n} after a stream ends, when reported

    def stream(self, system: str, prompt: str) -> Iterator[str]: ...


class OllamaLLM:
    def __init__(self, s: Settings):
        self.settings, self.model = s, s.ollama_chat_model
        self.name = f"ollama/{self.model}"
        self.usage: dict | None = None
        # No byte within the first-token limit raises httpx.ReadTimeout (a cold GPU included).
        self.timeout = httpx.Timeout(connect=10, read=s.first_token_timeout_s, write=30, pool=10)

    def stream(self, system: str, prompt: str) -> Iterator[str]:
        self.usage = None
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": prompt}],
            "stream": True,
            "think": False,  # qwen3 would otherwise spend seconds "thinking" before answering
        }
        with (ollama_client(self.settings, self.timeout) as client,
              client.stream("POST", "/api/chat", json=body) as resp):
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line:
                    continue
                data = json.loads(line)
                if data.get("done"):  # the final line carries the token counts
                    self.usage = {"input": data.get("prompt_eval_count", 0),
                                  "output": data.get("eval_count", 0)}
                piece = data.get("message", {}).get("content", "")
                if piece:
                    yield piece


class AnthropicLLM:
    """Local development only. The SDK reads the key from the developer's own shell."""

    def __init__(self, s: Settings):
        import anthropic

        self.client = anthropic.Anthropic()
        self.model = s.anthropic_model
        self.name = f"anthropic/{self.model}"
        self.usage: dict | None = None

    def stream(self, system: str, prompt: str) -> Iterator[str]:
        self.usage = None
        with self.client.beta.messages.stream(
            model=self.model,
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_config={"effort": "low"},  # grounded Q&A over given sources is a light task
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",  # if the model declines, the API retries on a fallback model
        ) as stream:
            yield from stream.text_stream
            usage = stream.get_final_message().usage
            self.usage = {"input": usage.input_tokens, "output": usage.output_tokens}


def available_providers(s: Settings | None = None) -> list[str]:
    """The providers this server allows: Ollama always, Claude only when switched on."""
    s = s or get_settings()
    return ["ollama", "anthropic"] if s.allow_anthropic else ["ollama"]


def check_provider(provider: str | None) -> None:
    """Raise ProviderDisabled when `provider` is known but not allowed here."""
    if provider in PROVIDERS and provider not in available_providers():
        raise ProviderDisabled(DISABLED_MESSAGE)


def get_llm(provider: str | None = None) -> LLM:
    s = get_settings()
    provider = provider or s.llm_provider
    check_provider(provider)
    if provider == "ollama":
        return OllamaLLM(s)
    if provider == "anthropic":
        return AnthropicLLM(s)
    raise ValueError(f"unknown LLM_PROVIDER {provider!r}: use 'ollama' or 'anthropic'")
