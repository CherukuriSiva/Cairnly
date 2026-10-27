"""LLM providers behind one tiny interface: `stream(system, prompt)` yields text pieces.

The rest of the app never imports a vendor SDK, so switching between free local Ollama and
the Claude API is one setting (LLM_PROVIDER), and tests use a fake that yields fixed text.
"""

import json
from collections.abc import Iterator
from typing import Protocol

import httpx

from cairnly.config import Settings, get_settings


class LLM(Protocol):
    name: str

    def stream(self, system: str, prompt: str) -> Iterator[str]: ...


class OllamaLLM:
    def __init__(self, s: Settings):
        self.url, self.model = s.ollama_url, s.ollama_chat_model
        self.name = f"ollama/{self.model}"

    def stream(self, system: str, prompt: str) -> Iterator[str]:
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": prompt}],
            "stream": True,
            "think": False,  # qwen3 would otherwise spend seconds "thinking" before answering
        }
        with httpx.stream("POST", f"{self.url}/api/chat", json=body, timeout=300) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if line:
                    piece = json.loads(line).get("message", {}).get("content", "")
                    if piece:
                        yield piece


class AnthropicLLM:
    def __init__(self, s: Settings):
        import anthropic

        self.client = anthropic.Anthropic(api_key=s.anthropic_api_key or None)
        self.model = s.anthropic_model
        self.name = f"anthropic/{self.model}"

    def stream(self, system: str, prompt: str) -> Iterator[str]:
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


def get_llm(provider: str | None = None) -> LLM:
    s = get_settings()
    provider = provider or s.llm_provider
    if provider == "ollama":
        return OllamaLLM(s)
    if provider == "anthropic":
        return AnthropicLLM(s)
    raise ValueError(f"unknown LLM_PROVIDER {provider!r}: use 'ollama' or 'anthropic'")
