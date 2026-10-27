"""Load a folder of markdown files into Postgres, re-embedding only what changed.

Each file's sha256 is stored with its document row. On a re-run:
- unchanged file -> skipped (no embedding calls, the expensive part)
- changed file   -> its old chunks are deleted and new ones inserted
- deleted file   -> its document row (and chunks, by cascade) is removed
"""

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import psycopg

from cairnly.chunk import chunk_markdown
from cairnly.curate import split_front_matter
from cairnly.embed import embed_documents

Embedder = Callable[[list[str]], list[list[float]]]


@dataclass
class IngestStats:
    added: int = 0
    updated: int = 0
    unchanged: int = 0
    deleted: int = 0
    chunks: int = 0


def embedding_text(title: str, trail: str, text: str) -> str:
    """What gets embedded: the title and heading trail give a bare section its context."""
    return f"{title} > {trail}\n{text}" if trail else f"{title}\n{text}"


def ingest_folder(conn: psycopg.Connection, folder: Path, source: str,
                  embedder: Embedder = embed_documents) -> IngestStats:
    stats = IngestStats()
    known = dict(conn.execute(
        "SELECT path, sha256 FROM documents WHERE source = %s", (source,)).fetchall())
    seen: set[str] = set()

    for path in sorted(folder.rglob("*.md")):
        rel = path.relative_to(folder).as_posix()
        raw = path.read_text()
        sha = hashlib.sha256(raw.encode()).hexdigest()
        seen.add(rel)
        if known.get(rel) == sha:
            stats.unchanged += 1
            continue
        meta, body = split_front_matter(raw)
        title = meta.get("title") or path.stem
        chunks = chunk_markdown(body)
        vectors = embedder([embedding_text(title, c.trail, c.text) for c in chunks])
        doc_id = conn.execute(
            """INSERT INTO documents (source, path, title, meta, sha256) VALUES (%s,%s,%s,%s,%s)
               ON CONFLICT (source, path) DO UPDATE SET title = EXCLUDED.title,
                 meta = EXCLUDED.meta, sha256 = EXCLUDED.sha256, updated_at = now()
               RETURNING id""",
            (source, rel, title, json.dumps(meta, default=str), sha),
        ).fetchone()[0]
        conn.execute("DELETE FROM chunks WHERE document_id = %s", (doc_id,))
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO chunks (document_id, ordinal, trail, start_line, end_line, text,
                   embedding) VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                [(doc_id, n, c.trail, c.start_line, c.end_line, c.text, v)
                 for n, (c, v) in enumerate(zip(chunks, vectors, strict=True))],
            )
        conn.commit()  # one commit per file: a crash mid-run keeps finished files
        stats.chunks += len(chunks)
        if rel in known:
            stats.updated += 1
        else:
            stats.added += 1

    gone = [p for p in known if p not in seen]
    if gone:
        conn.execute("DELETE FROM documents WHERE source = %s AND path = ANY(%s)", (source, gone))
        conn.commit()
        stats.deleted = len(gone)
    return stats
