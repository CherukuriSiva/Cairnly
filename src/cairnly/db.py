"""Postgres access: one connection helper and the schema.

The lessons: `documents` holds one row per source file with a content hash, so re-ingesting
skips unchanged files. `chunks` holds the searchable sections with both search indexes:
a generated `tsv` column for full-text search and an `embedding` column for vector search.
Each chunk also stores the `anchor` (heading id) of its section on the rendered page.

The chat (conversations.py): `conversations` is one saved chat with a random UUIDv4 id,
`messages` its questions and answers (with sources and the channel, text or voice), and
`feedback` one thumbs-up or thumbs-down per answer. Deleting a conversation deletes the rest.
Every statement is safe to re-run, so `migrate` also upgrades an existing database.
"""

import psycopg
from pgvector.psycopg import register_vector

from cairnly.config import get_settings

SCHEMA = """
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
    id          bigserial PRIMARY KEY,
    source      text NOT NULL,              -- e.g. "lessons"
    path        text NOT NULL,              -- path relative to the ingested folder
    title       text NOT NULL,
    meta        jsonb NOT NULL DEFAULT '{{}}',
    sha256      text NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, path)
);

CREATE TABLE IF NOT EXISTS chunks (
    id          bigserial PRIMARY KEY,
    document_id bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ordinal     int NOT NULL,               -- position within the document
    trail       text NOT NULL,              -- heading path, e.g. "The core idea > Retrieve"
    start_line  int NOT NULL,
    end_line    int NOT NULL,
    text        text NOT NULL,
    tsv         tsvector GENERATED ALWAYS AS (
                    to_tsvector('english', trail || ' ' || text)) STORED,
    embedding   vector({dim}) NOT NULL,
    anchor      text NOT NULL DEFAULT ''    -- heading id on the page, e.g. "why-this-matters"
);
-- Databases created before the anchor column existed get it here (safe to re-run).
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS anchor text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks (document_id);

CREATE TABLE IF NOT EXISTS conversations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- UUIDv4, unguessable
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_active_at  timestamptz NOT NULL DEFAULT now()            -- retention counts from here
);
CREATE INDEX IF NOT EXISTS conversations_last_active_idx ON conversations (last_active_at);

CREATE TABLE IF NOT EXISTS messages (
    id              bigserial PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            text NOT NULL CHECK (role IN ('user', 'assistant')),
    text            text NOT NULL,
    sources         jsonb,                  -- answers only: the numbered sources
    meta            jsonb,                  -- answers only: refused, guard, uncited, notice
    channel         text NOT NULL DEFAULT 'text' CHECK (channel IN ('text', 'voice')),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, id);

CREATE TABLE IF NOT EXISTS feedback (
    message_id  bigint PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    vote        text NOT NULL CHECK (vote IN ('up', 'down')),
    reason      text,                       -- optional, short (the API caps it)
    updated_at  timestamptz NOT NULL DEFAULT now()
);
"""


def connect(url: str | None = None) -> psycopg.Connection:
    conn = psycopg.connect(url or get_settings().database_url, autocommit=False)
    # With a WHERE filter (one knowledge base), a plain HNSW scan can return fewer rows than
    # LIMIT; iterative scan keeps walking the index until enough rows match.
    conn.execute("SET hnsw.iterative_scan = relaxed_order")
    conn.commit()
    try:
        register_vector(conn)
    except psycopg.ProgrammingError:
        pass  # extension not created yet: migrate() runs before the first registration
    return conn


def migrate(conn: psycopg.Connection, dim: int | None = None) -> None:
    conn.execute(SCHEMA.format(dim=dim or get_settings().embed_dim))
    conn.commit()
    register_vector(conn)
