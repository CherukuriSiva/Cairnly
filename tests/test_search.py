import pytest

from cairnly.ingest import embedding_text, ingest_folder
from cairnly.search import rrf, search
from tests.conftest import fake_vector


def test_rrf_rewards_agreement_between_lists():
    scores = rrf([1, 2, 3], [3, 1, 4], k=60)
    assert max(scores, key=scores.get) == 1  # rank 1 and rank 2 beats rank 3 and rank 1
    assert scores[4] == pytest.approx(1 / 63)
    assert set(scores) == {1, 2, 3, 4}


@pytest.mark.db
def test_hybrid_search_finds_keyword_and_vector_matches(conn, tmp_path, fake_embedder):
    (tmp_path / "rag.md").write_text(
        "---\ntitle: RAG\n---\n\n## Fusion\nReciprocal rank fusion merges ranked lists.\n")
    (tmp_path / "dsa.md").write_text(
        "---\ntitle: Arrays\n---\n\n## Windows\nSliding windows scan arrays.\n")
    ingest_folder(conn, tmp_path, "t", fake_embedder)

    by_keyword = search(conn, "rank fusion", embedder=lambda q: fake_vector("unrelated"))
    assert by_keyword.hits[0].title == "RAG"
    assert by_keyword.hits[0].citation == "RAG > Fusion (rag.md:1-2)"

    target = embedding_text("Arrays", "Windows", "## Windows\nSliding windows scan arrays.")
    by_vector = search(conn, "zzz", embedder=lambda q: fake_vector(target))
    assert by_vector.hits[0].title == "Arrays"
    assert by_vector.top_similarity == pytest.approx(1.0)


@pytest.mark.db
def test_empty_keyword_query_falls_back_to_vector_only(conn, tmp_path, fake_embedder):
    (tmp_path / "a.md").write_text("---\ntitle: A\n---\n\n## S\ntext\n")
    ingest_folder(conn, tmp_path, "t", fake_embedder)

    result = search(conn, "the a of", embedder=lambda q: fake_vector("x"))  # only stop words

    assert [h.title for h in result.hits] == ["A"]


@pytest.mark.db
def test_kb_filter_limits_results_to_one_knowledge_base(conn, tmp_path, fake_embedder):
    (tmp_path / "x.md").write_text("---\ntitle: Fusion\n---\n\n## RRF\nrank fusion\n")
    ingest_folder(conn, tmp_path, "lessons", fake_embedder)
    ingest_folder(conn, tmp_path, "papers", fake_embedder)

    hits = search(conn, "rank fusion", kb="papers", embedder=lambda q: fake_vector("x")).hits

    paths = conn.execute("SELECT c.id, d.source FROM chunks c JOIN documents d "
                         "ON d.id = c.document_id").fetchall()
    sources = dict(paths)
    assert hits and all(sources[h.chunk_id] == "papers" for h in hits)


def _lesson(root, track: str, slug: str, heading: str) -> None:
    folder = root / "lessons" / track
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{slug}.mdx").write_text(
        f"---\nslug: {slug}\ntitle: {slug}\ntrack: {track}\n---\n\n"
        f"<Body>\n## {heading}\nrank fusion merges ranked lists.\n</Body>\n")


@pytest.mark.db
def test_track_filter_and_page_urls(conn, tmp_path, fake_embedder):
    _lesson(tmp_path, "ai-engineering", "hybrid", "Rank fusion")
    _lesson(tmp_path, "dsa", "merging", "Merge lists")
    ingest_folder(conn, tmp_path, "lessons", fake_embedder)

    everything = search(conn, "rank fusion", embedder=lambda q: fake_vector("x"))
    assert {h.url for h in everything.hits} == {
        "/ai-engineering/hybrid#rank-fusion", "/dsa/merging#merge-lists"}

    scoped = search(conn, "rank fusion", track="dsa", embedder=lambda q: fake_vector("x"))
    assert [h.url for h in scoped.hits] == ["/dsa/merging#merge-lists"]
