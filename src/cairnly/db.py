"""Postgres access: one connection helper and the schema.

Two tables. `documents` holds one row per source file with a content hash, so re-ingesting
skips unchanged files. `chunks` holds the searchable sections with both search indexes:
a generated `tsv` column for full-text search and an `embedding` column for vector search.
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
    embedding   vector({dim}) NOT NULL
);

CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks (document_id);
"""


def connect(url: str | None = None) -> psycopg.Connection:
    conn = psycopg.connect(url or get_settings().database_url, autocommit=False)
    try:
        register_vector(conn)
    except psycopg.ProgrammingError:
        pass  # extension not created yet: migrate() runs before the first registration
    return conn


def migrate(conn: psycopg.Connection, dim: int | None = None) -> None:
    conn.execute(SCHEMA.format(dim=dim or get_settings().embed_dim))
    conn.commit()
    register_vector(conn)
