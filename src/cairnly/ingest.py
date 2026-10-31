"""Load documents into Postgres, re-embedding only what changed.

Connectors turn a source (a folder of markdown or MDX, a JSONL file of passages) into SourceDocs.
Each document's sha256 is stored with its document row. On a re-run:
- unchanged document -> skipped (no embedding calls, the expensive part)
- changed document -> its old chunks are deleted and new ones inserted
- deleted document -> its row (and chunks, by cascade) is removed
"""

import hashlib
import json
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass, replace
from pathlib import Path

import psycopg

from cairnly.chunk import Chunk, chunk_markdown
from cairnly.embed import embed_documents
from cairnly.mdx import mdx_to_markdown, split_front_matter
from cairnly.pages import anchor_at, heading_anchors

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


@dataclass
class SourceDoc:
    """One document from any connector. `build` is only called when the hash changed."""

    path: str
    sha256: str
    build: Callable[[], tuple[str, dict, list[Chunk]]]  # -> (title, meta, chunks)


def markdown_docs(folder: Path) -> Iterator[SourceDoc]:
    """Connector: every .md and .mdx file under a folder (README.md files are skipped).

    MDX is converted to markdown first. One chunk per heading section, each carrying the
    anchor of its heading on the rendered page. The hash is taken on the raw file text.
    """
    paths = [p for p in folder.rglob("*") if p.suffix in (".md", ".mdx") and p.is_file()]
    for path in sorted(p for p in paths if p.name != "README.md"):
        raw = path.read_text()

        def build(raw=raw, path=path):
            meta, body = split_front_matter(raw)
            if path.suffix == ".mdx":
                body, _ = mdx_to_markdown(body)
            return meta.get("title") or path.stem, meta, chunks_with_anchors(body)

        yield SourceDoc(path.relative_to(folder).as_posix(), _sha(raw), build)


def chunks_with_anchors(body: str) -> list[Chunk]:
    """Chunk markdown and give each chunk the anchor of the last heading at or before it."""
    anchors = heading_anchors(body)
    return [replace(c, anchor=anchor_at(anchors, c.start_line)) for c in chunk_markdown(body)]


def jsonl_docs(file: Path) -> Iterator[SourceDoc]:
    """Connector: one passage per line, {"id", "text", "source_title"?, ...}; one chunk each."""
    for line_no, line in enumerate(file.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        record = json.loads(line)

        def build(record=record, line_no=line_no):
            meta = {k: v for k, v in record.items() if k not in ("id", "text")}
            title = record.get("source_title") or record["id"]
            return title, meta, [Chunk("", line_no, line_no, record["text"])]

        yield SourceDoc(record["id"], _sha(line), build)


def docs_for(path: Path) -> Iterator[SourceDoc]:
    return jsonl_docs(path) if path.suffix == ".jsonl" else markdown_docs(path)


def ingest_folder(conn: psycopg.Connection, folder: Path, source: str,
                  embedder: Embedder = embed_documents) -> IngestStats:
    return ingest_docs(conn, markdown_docs(folder), source, embedder)


def ingest_docs(conn: psycopg.Connection, docs: Iterable[SourceDoc], source: str,
                embedder: Embedder = embed_documents) -> IngestStats:
    stats = IngestStats()
    known = dict(conn.execute(
        "SELECT path, sha256 FROM documents WHERE source = %s", (source,)).fetchall())
    seen: set[str] = set()

    for doc in docs:
        seen.add(doc.path)
        if known.get(doc.path) == doc.sha256:
            stats.unchanged += 1
            continue
        title, meta, chunks = doc.build()
        vectors = embedder([embedding_text(title, c.trail, c.text) for c in chunks])
        doc_id = conn.execute(
            """INSERT INTO documents (source, path, title, meta, sha256) VALUES (%s,%s,%s,%s,%s)
               ON CONFLICT (source, path) DO UPDATE SET title = EXCLUDED.title,
                 meta = EXCLUDED.meta, sha256 = EXCLUDED.sha256, updated_at = now()
               RETURNING id""",
            (source, doc.path, title, json.dumps(meta, default=str), doc.sha256),
        ).fetchone()[0]
        conn.execute("DELETE FROM chunks WHERE document_id = %s", (doc_id,))
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO chunks (document_id, ordinal, trail, start_line, end_line, text,
                   embedding, anchor) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                [(doc_id, n, c.trail, c.start_line, c.end_line, c.text, v, c.anchor)
                 for n, (c, v) in enumerate(zip(chunks, vectors, strict=True))],
            )
        conn.commit()  # one commit per document: a crash mid-run keeps finished ones
        stats.chunks += len(chunks)
        if doc.path in known:
            stats.updated += 1
        else:
            stats.added += 1

    gone = [p for p in known if p not in seen]
    if gone:
        conn.execute("DELETE FROM documents WHERE source = %s AND path = ANY(%s)", (source, gone))
        conn.commit()
        stats.deleted = len(gone)
    return stats


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()
