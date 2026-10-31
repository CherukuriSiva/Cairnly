import pytest

from cairnly import rerank
from cairnly.kb import KnowledgeBase
from cairnly.search import Hit, SearchResult, search, search_kb
from tests.conftest import fake_vector


def _hit(n: int, text: str) -> Hit:
    return Hit(n, "T", f"{n}.md", "", 1, 1, text)


def test_rerank_orders_by_cross_encoder_score(monkeypatch):
    class FakeModel:
        def predict(self, pairs):
            return [len(text) for _, text in pairs]  # longer text = "more relevant"

    monkeypatch.setattr(rerank, "_model", lambda name: FakeModel())
    hits = [_hit(1, "a"), _hit(2, "aaa"), _hit(3, "aa")]

    assert [h.chunk_id for h in rerank.rerank("q", hits)] == [2, 3, 1]
    assert rerank.rerank("q", hits[:1]) == hits[:1]  # nothing to reorder


def test_search_kb_uses_reranker_only_when_enabled_and_installed(monkeypatch):
    calls = []
    monkeypatch.setattr("cairnly.search.search",
                        lambda conn, q, top_k, kb, reranker, track=None: calls.append(reranker) or
                        SearchResult([], 0.0))
    monkeypatch.setattr(rerank, "available", lambda: True)
    on = KnowledgeBase("a", "A", "p", 0.5, "answer-v1", rerank=True)
    off = KnowledgeBase("b", "B", "p", 0.5, "answer-v1", rerank=False)

    search_kb(None, "q", on)
    search_kb(None, "q", off)
    monkeypatch.setattr(rerank, "available", lambda: False)
    search_kb(None, "q", on)

    assert calls == [rerank.rerank, None, None]


@pytest.mark.db
def test_search_applies_reranker_before_the_top_k_cut(conn, tmp_path, fake_embedder):
    from cairnly.ingest import ingest_folder

    for n in range(5):
        (tmp_path / f"{n}.md").write_text(f"---\ntitle: Doc {n}\n---\n\n## S\nshared words {n}\n")
    ingest_folder(conn, tmp_path, "t", fake_embedder)

    last_first = lambda q, hits: sorted(hits, key=lambda h: h.title, reverse=True)  # noqa: E731
    result = search(conn, "shared words", top_k=2, embedder=lambda q: fake_vector("x"),
                    reranker=last_first)

    assert [h.title for h in result.hits] == ["Doc 4", "Doc 3"]
