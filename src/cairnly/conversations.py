"""Saved conversations: the questions and answers of one chat, kept in Postgres.

A conversation is a random UUIDv4 made by the database. The browser keeps it (localStorage)
and sends it with each question; there are no accounts, so the id is the only key. Anyone who
knows the id can read the conversation, which is why it must stay unguessable and why the
routes never list conversations.

What is saved (api.py calls `save_turn` when an answer stream ends with `done`):
- the question as the reader typed it, and the answer as the reader saw it: the streamed text,
  or the safety message when the output check withdrew it. Refusals ("not in the lessons", a
  guard block) are saved too, so a restored chat looks the way it did.
- with the answer: its numbered sources and a few outcome fields (refused, guard, uncited,
  notice), so the chat can show the same notes and source cards after a reload.
- the channel: "text" for the chat, "voice" for a spoken turn.
An answer that ends with an error, a client that leaves mid-answer, or a stopped answer saves
nothing: the reader never saw a finished turn, so there is nothing to restore.

History for follow-ups comes from here when the chat sends a conversation id: the last
MAX_TURNS finished turns, skipping turns the guard refused (the server checks every earlier
question, so one blocked attack would otherwise block every follow-up after it).

Retention: a conversation idle for RETENTION_DAYS is deleted with its messages and votes.
`prune_idle` runs at most once an hour per API process, on conversation create (see api.py),
so it costs one indexed DELETE now and then and needs no scheduler.
"""

import time
from dataclasses import dataclass, field

import psycopg
from psycopg.types.json import Jsonb

from cairnly.rewrite import MAX_TURNS

RETENTION_DAYS = 30
PRUNE_EVERY_S = 3600
HISTORY_SCAN = 40  # messages read to find the last MAX_TURNS usable turns
MAX_QUESTION_CHARS = 2000  # the same limits /ask puts on client-sent history
MAX_ANSWER_CHARS = 4000
CHANNELS = ("text", "voice")
VOTES = ("up", "down")
# A canonical lowercase UUIDv4, the only id form the routes accept.
UUID4 = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
OUTCOME_FIELDS = ("refused", "guard", "uncited", "notice")


@dataclass
class Turn:
    """One finished question and answer, ready to save."""

    question: str
    answer: str
    sources: list[dict] = field(default_factory=list)
    outcome: dict = field(default_factory=dict)  # refused, guard, uncited, notice
    channel: str = "text"


def create(conn: psycopg.Connection) -> dict:
    row = conn.execute(
        "INSERT INTO conversations DEFAULT VALUES RETURNING id::text, created_at").fetchone()
    conn.commit()
    return {"id": row[0], "created_at": row[1].isoformat()}


def exists(conn: psycopg.Connection, conversation_id: str) -> bool:
    return conn.execute("SELECT 1 FROM conversations WHERE id = %s",
                        (conversation_id,)).fetchone() is not None


def read(conn: psycopg.Connection, conversation_id: str) -> dict | None:
    """The conversation with its messages, oldest first, and the vote on each answer; None when
    the id is unknown."""
    head = conn.execute("SELECT id::text, created_at, last_active_at FROM conversations "
                        "WHERE id = %s", (conversation_id,)).fetchone()
    if head is None:
        return None
    rows = conn.execute(
        "SELECT m.id, m.role, m.text, m.sources, m.meta, m.channel, m.created_at, f.vote "
        "FROM messages m LEFT JOIN feedback f ON f.message_id = m.id "
        "WHERE m.conversation_id = %s ORDER BY m.id", (conversation_id,)).fetchall()
    return {"id": head[0], "created_at": head[1].isoformat(),
            "last_active_at": head[2].isoformat(),
            "messages": [_message(*row) for row in rows]}


def _message(id, role, text, sources, meta, channel, created_at, vote) -> dict:
    message = {"id": id, "role": role, "text": text, "channel": channel,
               "created_at": created_at.isoformat()}
    if role == "assistant":
        message |= {"sources": sources or [], "vote": vote,
                    **{k: (meta or {}).get(k) for k in OUTCOME_FIELDS}}
    return message


def delete(conn: psycopg.Connection, conversation_id: str) -> bool:
    deleted = conn.execute("DELETE FROM conversations WHERE id = %s",
                           (conversation_id,)).rowcount
    conn.commit()
    return deleted > 0


def history(conn: psycopg.Connection, conversation_id: str,
            limit: int = MAX_TURNS) -> list[dict]:
    """The last `limit` finished turns as {question, answer}, oldest first, for the follow-up
    rewrite. Turns the guard refused are skipped; long texts are cut to the /ask limits."""
    rows = conn.execute(
        "SELECT role, text, meta FROM messages WHERE conversation_id = %s "
        "ORDER BY id DESC LIMIT %s", (conversation_id, HISTORY_SCAN)).fetchall()
    turns: list[dict] = []
    question: str | None = None
    for role, text, meta in reversed(rows):
        if role == "user":
            question = text
        elif question is not None:
            if not (meta or {}).get("guard"):
                turns.append({"question": question[:MAX_QUESTION_CHARS],
                              "answer": text[:MAX_ANSWER_CHARS]})
            question = None
    return turns[-limit:] if limit > 0 else []


def save_turn(conn: psycopg.Connection, conversation_id: str, turn: Turn) -> tuple[int, int]:
    """Save the question and its answer in one transaction and mark the conversation active.
    Returns the ids of the user and the assistant message."""
    if turn.channel not in CHANNELS:
        raise ValueError(f"unknown channel {turn.channel!r}")
    outcome = {k: turn.outcome.get(k) for k in OUTCOME_FIELDS if turn.outcome.get(k)}
    try:
        user_id = conn.execute(
            "INSERT INTO messages (conversation_id, role, text, channel) "
            "VALUES (%s, 'user', %s, %s) RETURNING id",
            (conversation_id, turn.question, turn.channel)).fetchone()[0]
        answer_id = conn.execute(
            "INSERT INTO messages (conversation_id, role, text, sources, meta, channel) "
            "VALUES (%s, 'assistant', %s, %s, %s, %s) RETURNING id",
            (conversation_id, turn.answer, Jsonb(turn.sources), Jsonb(outcome),
             turn.channel)).fetchone()[0]
        conn.execute("UPDATE conversations SET last_active_at = now() WHERE id = %s",
                     (conversation_id,))
        conn.commit()
    except BaseException:
        conn.rollback()  # neither message is saved without the other
        raise
    return user_id, answer_id


def set_vote(conn: psycopg.Connection, conversation_id: str, message_id: int,
             vote: str | None, reason: str | None = None) -> bool:
    """Set (or with vote=None clear) the vote on one answer of this conversation; the latest
    call wins. False when the message is not an answer in this conversation."""
    if vote is not None and vote not in VOTES:
        raise ValueError(f"unknown vote {vote!r}")
    found = conn.execute(
        "SELECT 1 FROM messages WHERE id = %s AND conversation_id = %s AND role = 'assistant'",
        (message_id, conversation_id)).fetchone()
    if found is None:
        conn.rollback()
        return False
    if vote is None:
        conn.execute("DELETE FROM feedback WHERE message_id = %s", (message_id,))
    else:
        conn.execute(
            "INSERT INTO feedback (message_id, vote, reason) VALUES (%s, %s, %s) "
            "ON CONFLICT (message_id) DO UPDATE "
            "SET vote = EXCLUDED.vote, reason = EXCLUDED.reason, updated_at = now()",
            (message_id, vote, reason or None))
    conn.commit()
    return True


def prune_idle(conn: psycopg.Connection, days: int = RETENTION_DAYS) -> int:
    """Delete conversations idle for more than `days` days (messages and votes go with them)."""
    deleted = conn.execute(
        "DELETE FROM conversations WHERE last_active_at < now() - make_interval(days => %s)",
        (days,)).rowcount
    conn.commit()
    return deleted


class Pruner:
    """Runs prune_idle at most once per `every_s` seconds; the clock is injectable for tests."""

    def __init__(self, every_s: float = PRUNE_EVERY_S, now=time.monotonic):
        self.every_s, self.now = every_s, now
        self.last: float | None = None

    def maybe_prune(self, conn: psycopg.Connection, days: int = RETENTION_DAYS) -> int | None:
        now = self.now()
        if self.last is not None and now - self.last < self.every_s:
            return None
        self.last = now
        return prune_idle(conn, days)


class Transcript:
    """Follows one answer's events and keeps what the reader saw: the sources, and the streamed
    text or the safety message once the output check withdrew it."""

    def __init__(self) -> None:
        self.sources: list[dict] = []
        self.text = ""

    def see(self, event: dict) -> None:
        if event["type"] == "sources":
            self.sources = event["sources"]
        elif event["type"] == "token":
            self.text += event["text"]
        elif event["type"] == "retract":
            self.text = event["message"]
