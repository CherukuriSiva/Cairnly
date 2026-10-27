import pytest

from cairnly.ingest import embedding_text, ingest_folder

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
