"""Optional Langfuse tracing: one trace per question, with a child per pipeline step.

A trace answers "why was this answer slow or wrong?" for one request: which guard rule ran,
what was retrieved, the best similarity, which prompt version and model ran, how long until
the first token, the token usage, and whether it errored. Set LANGFUSE_PUBLIC_KEY and
LANGFUSE_SECRET_KEY (and LANGFUSE_HOST for a self-hosted server) to turn it on; without them
every call here is a no-op. The SDK also reads LANGFUSE_TRACING_ENVIRONMENT, LANGFUSE_RELEASE
and LANGFUSE_SAMPLE_RATE from the environment.

Privacy: traces hold no question or answer text unless TRACE_CONTENT is on (answer.py builds
the payloads; ADR 0015). The trace groups follow-ups by the chat's random per-tab session id,
never by a user id or IP address.

Spans are explicit objects passed around, not "the current span": /ask streams from a
generator that the server may resume on different threads, which breaks context-based
nesting. Tracing must never break an answer, so a client that cannot start is treated as off,
and every call into the SDK swallows its exceptions.
"""

import os
from functools import lru_cache
from typing import Any


class Span:
    """A Langfuse span or generation; the base class is the no-op used when tracing is off."""

    def child(self, name: str, *, generation: bool = False, **fields: Any) -> "Span":
        return NO_SPAN

    def update(self, **fields: Any) -> None:
        pass

    def update_trace(self, **fields: Any) -> None:
        pass

    def score(self, name: str, value: float) -> None:
        """Attach a numeric score to the whole trace."""

    def end(self, **fields: Any) -> None:
        pass


NO_SPAN = Span()


class _LangfuseSpan(Span):
    """Wraps one SDK observation. A failing SDK call is dropped: tracing never costs an
    answer."""

    def __init__(self, observation):
        self.observation = observation

    def child(self, name: str, *, generation: bool = False, **fields: Any) -> Span:
        try:
            start = (self.observation.start_generation if generation
                     else self.observation.start_span)
            return _LangfuseSpan(start(name=name, **fields))
        except Exception:
            return NO_SPAN

    def update(self, **fields: Any) -> None:
        try:
            self.observation.update(**fields)
        except Exception:
            pass

    def update_trace(self, **fields: Any) -> None:
        try:
            self.observation.update_trace(**fields)
        except Exception:
            pass

    def score(self, name: str, value: float) -> None:
        try:
            self.observation.score_trace(name=name, value=value)
        except Exception:
            pass

    def end(self, **fields: Any) -> None:
        try:
            if fields:
                self.observation.update(**fields)
            self.observation.end()
        except Exception:
            pass


@lru_cache(maxsize=1)
def client():
    """The Langfuse client, or None when tracing is off or cannot start."""
    if not (os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY")):
        return None
    try:
        from langfuse import Langfuse

        return Langfuse()  # reads LANGFUSE_HOST, keys, environment and release from the env
    except Exception:  # a broken tracer must never cost an answer
        return None


def start_trace(name: str, *, input: Any = None, metadata: dict | None = None,
                tags: list[str] | None = None, session_id: str | None = None,
                version: str | None = None) -> Span:
    langfuse = client()
    if langfuse is None:
        return NO_SPAN
    try:
        root = langfuse.start_span(name=name, input=input, metadata=metadata)
        root.update_trace(name=name, input=input, tags=tags, metadata=metadata,
                          session_id=session_id, version=version)
        return _LangfuseSpan(root)
    except Exception:
        return NO_SPAN


def flush() -> None:
    """Send buffered traces now (short CLI runs exit before the background batch is sent)."""
    langfuse = client()
    if langfuse is not None:
        try:
            langfuse.flush()
        except Exception:
            pass


def shutdown() -> None:
    """Flush and stop the background sender; the API calls this when the server stops."""
    langfuse = client()
    if langfuse is not None:
        try:
            langfuse.shutdown()
        except Exception:
            pass
