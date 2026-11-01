"""Rewrite a follow-up question into a standalone one before searching.

"How do I evaluate it?" finds nothing useful on its own: "it" lives in the conversation. A
small LLM call turns the follow-up plus the recent turns into one standalone question
("How do I evaluate a RAG pipeline?"), and search runs on that. Any failure (an exception, an
empty, multi-line or overlong reply, or a reply slower than the time limit) falls back to the
original question, so rewriting can make retrieval better but never stops an answer.
"""

from collections.abc import Sequence

from cairnly.config import get_settings
from cairnly.kb import load_prompt
from cairnly.llm import LLM, time_limited

MAX_TURNS = 6  # earlier turns a client may send (the API rejects more)
MAX_ANSWER_CHARS = 600  # each earlier answer is cut to this before it reaches the prompt
MAX_REWRITE_CHARS = 300
PROMPT_VERSION = "rewrite-v1"


def format_history(history: Sequence[dict], question: str) -> str:
    """The conversation as Q:/A: pairs, then the follow-up to rewrite."""
    lines = ["Conversation:"]
    for turn in history[-MAX_TURNS:]:
        lines += [f"Q: {turn['question']}", f"A: {turn['answer'][:MAX_ANSWER_CHARS]}", ""]
    lines.append(f"Follow-up question: {question}")
    return "\n".join(lines)


def rewrite_question(question: str, history: Sequence[dict], llm: LLM,
                     time_limit_s: float | None = None) -> str:
    """A standalone version of `question`, or `question` itself when there is no history or the
    rewrite fails. The whole rewrite must finish within `time_limit_s` (default: the first-token
    limit, FIRST_TOKEN_TIMEOUT_S)."""
    if not history:
        return question
    limit = time_limit_s if time_limit_s is not None else get_settings().first_token_timeout_s
    try:
        stream = llm.stream(load_prompt(PROMPT_VERSION), format_history(history, question))
        reply = "".join(time_limited(stream, limit))
    except Exception:  # a failed rewrite must never cost an answer
        return question
    lines = [line.strip() for line in reply.strip().splitlines() if line.strip()]
    if len(lines) != 1:
        return question
    candidate = lines[0].strip("\"'“”‘’ ").strip()
    return candidate if 0 < len(candidate) <= MAX_REWRITE_CHARS else question
