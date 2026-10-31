"""Optional Langfuse tracing: one trace per question, with a child per pipeline step.

A trace answers "why was this answer slow or wrong?" for one request: what was retrieved, the
best similarity, which prompt version and model ran, how long until the first token, and
the final answer. Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY (and LANGFUSE_HOST for a
self-hosted server) to turn it on; without them every call here is a no-op.

Spans are explicit objects passed around, not "the current span": /ask streams from a
generator that the server may resume on different threads, which breaks context-based
nesting. Tracing must never break an answer, so a client that cannot start is treated as off.
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

    def end(self, **fields: Any) -> None:
        pass


NO_SPAN = Span()


class _LangfuseSpan(Span):
    def __init__(self, observation):
        self.observation = observation

    def child(self, name: str, *, generation: bool = False, **fields: Any) -> Span:
        start = self.observation.start_generation if generation else self.observation.start_span
        return _LangfuseSpan(start(name=name, **fields))

    def update(self, **fields: Any) -> None:
        self.observation.update(**fields)

    def end(self, **fields: Any) -> None:
        if fields:
            self.observation.update(**fields)
        self.observation.end()


@lru_cache(maxsize=1)
def client():
    """The Langfuse client, or None when tracing is off or cannot start."""
    if not (os.environ.get("LANGFUSE_PUBLIC_KEY") and os.environ.get("LANGFUSE_SECRET_KEY")):
        return None
    try:
        from langfuse import Langfuse

        return Langfuse()  # reads LANGFUSE_HOST, keys and environment from the environment
    except Exception:  # a broken tracer must never cost an answer
        return None


def start_trace(name: str, *, input: Any = None, metadata: dict | None = None,
                tags: list[str] | None = None) -> Span:
    langfuse = client()
    if langfuse is None:
        return NO_SPAN
    root = langfuse.start_span(name=name, input=input, metadata=metadata)
    root.update_trace(name=name, input=input, tags=tags, metadata=metadata)
    return _LangfuseSpan(root)


def flush() -> None:
    """Send buffered traces now (short CLI runs exit before the background batch is sent)."""
    langfuse = client()
    if langfuse is not None:
        langfuse.flush()
