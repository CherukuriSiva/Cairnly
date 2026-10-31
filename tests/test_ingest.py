import json

import pytest

from cairnly.ingest import docs_for, embedding_text, ingest_docs, ingest_folder

pytestmark = pytest.mark.db

DOC = "---\ntitle: What is RAG\n---\n\n## Idea\nRetrieve then generate.\n\n## Why\nCitations.\n"


def test_embedding_text_includes_title_and_trail():
    assert embedding_text("T", "A > B", "x") == "T > A > B\nx"
    assert embedding_text("T", "", "x") == "T\nx"


def test_ingest_is_incremental(conn, tmp_path, fake_embedder):
    (tmp_path / "rag.md").write_text(DOC)
    (tmp_path / "old.md").write_text("---\ntitle: Old\n---\n\n## Gone\nSoon deleted.\n")

    first = ingest_folder(conn, tmp_path, "lessons", fake_embedder)
    assert (first.added, first.chunks) == (2, 3)

    calls_before = len(fake_embedder.calls)
    again = ingest_folder(conn, tmp_path, "lessons", fake_embedder)
    assert again.unchanged == 2 and len(fake_embedder.calls) == calls_before  # nothing re-embedded

    (tmp_path / "rag.md").write_text(DOC + "\n## New\nMore.\n")
    (tmp_path / "old.md").unlink()
    third = ingest_folder(conn, tmp_path, "lessons", fake_embedder)
    assert (third.updated, third.deleted) == (1, 1)

    rows = conn.execute(
        "SELECT d.path, c.trail FROM chunks c JOIN documents d ON d.id = c.document_id "
        "ORDER BY c.ordinal").fetchall()
    assert rows == [("rag.md", "Idea"), ("rag.md", "Why"), ("rag.md", "New")]


MDX = (
    "---\nslug: what-is-rag\ntitle: What is RAG\ntrack: ai-engineering\n---\n\n"
    "<WhyThisMatters>\nCitations matter.\n</WhyThisMatters>\n\n"
    "<Body>\n## The core idea\nRetrieve then generate.\n\n## The core idea\nAgain.\n</Body>\n\n"
    '<BookNote chapter="6">\n\nOur own note.\n</BookNote>\n'
)


def test_mdx_is_converted_and_chunks_store_anchors(conn, tmp_path, fake_embedder):
    folder = tmp_path / "lessons" / "ai-engineering"
    folder.mkdir(parents=True)
    (folder / "what-is-rag.mdx").write_text(MDX)
    (tmp_path / "README.md").write_text("# About this folder\nNot a lesson.\n")

    stats = ingest_folder(conn, tmp_path, "lessons", fake_embedder)
    assert stats.added == 1  # README.md skipped

    rows = conn.execute(
        "SELECT d.path, d.title, d.meta->>'track', c.trail, c.anchor, c.text FROM chunks c "
        "JOIN documents d ON d.id = c.document_id ORDER BY c.ordinal").fetchall()
    assert [r[0] for r in rows] == ["lessons/ai-engineering/what-is-rag.mdx"] * 4
    assert rows[0][1:3] == ("What is RAG", "ai-engineering")
    assert [(r[3], r[4]) for r in rows] == [
        ("Why this matters", "why-this-matters"),
        ("The core idea", "the-core-idea"),
        ("The core idea", "the-core-idea-1"),
        ("From AI Engineering (Chip Huyen)", "from-ai-engineering-chip-huyen"),
    ]
    assert not any("<" in r[5] for r in rows)  # no MDX tags left in chunk text

    again = ingest_folder(conn, tmp_path, "lessons", fake_embedder)
    assert (again.unchanged, again.chunks) == (1, 0)


def test_jsonl_connector_one_chunk_per_passage_and_incremental(conn, tmp_path, fake_embedder):
    file = tmp_path / "passages.jsonl"
    rows = [{"id": "p1", "text": "Retrieval narrows the context.", "source_title": "Retrieval"},
            {"id": "p2", "text": "Reranking orders the hits.", "license": "x"}]
    file.write_text("\n".join(json.dumps(r) for r in rows) + "\n")

    first = ingest_docs(conn, docs_for(file), "passages", fake_embedder)
    assert (first.added, first.chunks) == (2, 2)

    rows[1]["text"] = "Reranking orders the hits again."
    file.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    second = ingest_docs(conn, docs_for(file), "passages", fake_embedder)
    assert (second.unchanged, second.updated) == (1, 1)

    titles = conn.execute(
        "SELECT d.path, d.title, d.meta->>'license', c.start_line FROM documents d "
        "JOIN chunks c ON c.document_id = d.id ORDER BY d.path").fetchall()
    assert titles == [("p1", "Retrieval", None, 1), ("p2", "p2", "x", 2)]


def test_sources_are_isolated_from_each_other(conn, tmp_path, fake_embedder):
    (tmp_path / "a.md").write_text(DOC)
    ingest_folder(conn, tmp_path, "one", fake_embedder)
    ingest_folder(conn, tmp_path, "two", fake_embedder)
    (tmp_path / "a.md").unlink()

    ingest_folder(conn, tmp_path, "one", fake_embedder)  # deletes only from "one"

    counts = dict(conn.execute("SELECT source, count(*) FROM documents GROUP BY source").fetchall())
    assert counts == {"two": 1}


def test_folder_notices_are_not_ingested(tmp_path):
    from cairnly.ingest import markdown_docs

    (tmp_path / "lesson.md").write_text("# Lesson\nText.\n")
    (tmp_path / "README.md").write_text("# About this folder\n")
    (tmp_path / "LICENSE.md").write_text("# Content license\n")
    assert [doc.path for doc in markdown_docs(tmp_path)] == ["lesson.md"]
