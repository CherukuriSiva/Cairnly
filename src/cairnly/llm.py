"""LLM providers behind one tiny interface: `stream(system, prompt)` yields text pieces.

The rest of the app never imports a vendor SDK, so switching between Ollama and the Claude API
is one setting (LLM_PROVIDER), and tests use a fake that yields fixed text. After a stream
ends, `usage` holds the token counts the provider reported (None when it reported none), so
traces can show cost per answer.

Claude is local only: `get_llm("anthropic")` raises ProviderDisabled unless ALLOW_ANTHROPIC is
set, and config.py refuses that setting on a production server.
"""

import json
from collections.abc import Iterator
from typing import Protocol

import httpx

from cairnly.config import Settings, get_settings
from cairnly.ollama import ollama_client

PROVIDERS = ("ollama", "anthropic")
DISABLED_MESSAGE = "The Claude API is turned off on this server."


class ProviderDisabled(Exception):
    """The requested provider exists but this server does not allow it."""


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
