
import pytest

from cairnly.evals import (
    GoldenItem,
    check_gates,
    gate_metrics,
    judge,
    lessons_golden,
    retrieval_metrics,
    run_retrieval,
    suggest_min_score,
)
from cairnly.search import Hit, SearchResult


def _hit(path: str, trail: str = "Body") -> Hit:
    return Hit(1, "T", path, trail, 1, 2, "text")


def test_lessons_golden_uses_quiz_questions_relative_to_the_ingested_root(tmp_path):
    lesson = tmp_path / "public" / "lessons" / "rag.md"
    lesson.parent.mkdir(parents=True)
    lesson.write_text("## Quick quiz\n**Q: When does RAG beat prompting?**\n- A) never\n")

    [item] = lessons_golden(tmp_path / "public", root=tmp_path)

    assert item.question == "When does RAG beat prompting?"
    assert item.gold == {"public/lessons/rag.md"}
    assert item.exclude_trails == ("Quick quiz",)


def test_run_retrieval_skips_excluded_trails_when_ranking():
    item = GoldenItem("q", "?", frozenset(["a.md"]), exclude_trails=("Quick quiz",))
    hits = [_hit("a.md", "Quick quiz"), _hit("b.md"), _hit("a.md", "Idea > Why")]

    [result] = run_retrieval([item], lambda q: SearchResult(hits, 0.8))

    assert result.rank == 2  # the quiz hit does not count; the teaching section is rank 2


def test_retrieval_metrics_recall_and_mrr():
    items = [GoldenItem(str(n), "?", frozenset(["g"])) for n in range(4)]
    ranked = [[_hit("g")], [_hit("x"), _hit("g")], [_hit("x")] * 6 + [_hit("g")], [_hit("x")]]
    results = [run_retrieval([i], lambda q, h=h: SearchResult(h, 0.7))[0]
               for i, h in zip(items, ranked, strict=True)]

    m = retrieval_metrics(results, k=5)

    assert m["questions"] == 4
    assert m["recall@5"] == 0.5  # ranks 1 and 2 are in the top 5; rank 7 and a miss are not
    assert m["mrr"] == pytest.approx((1 + 1 / 2 + 1 / 7) / 4, abs=1e-4)


def test_gate_metrics_and_suggested_cutoff():
    on_topic, off_topic = [0.8, 0.75, 0.7, 0.62], [0.6, 0.5, 0.66]

    g = gate_metrics(on_topic, off_topic, min_score=0.65)

    assert g["false_refusal_rate"] == 0.25  # 0.62 refused
    assert g["false_accept_rate"] == pytest.approx(1 / 3, abs=1e-4)  # 0.66 accepted
    assert suggest_min_score(on_topic, off_topic) == 0.62  # one error, the fewest possible


def test_check_gates_treats_rates_as_maximums():
    report = {"recall@5": 0.7, "mrr": 0.9, "false_accept_rate": 0.2}
    failures = check_gates(report, {"recall@5": 0.8, "mrr": 0.5, "false_accept_rate": 0.05})
    assert failures == ["recall@5 = 0.7 is below the minimum 0.8",
                        "false_accept_rate = 0.2 is above the limit 0.05"]


def test_judge_parses_json_even_with_surrounding_text():
    class Judge:
        def stream(self, system, prompt):
            yield 'Sure: {"supported": false, "unsupported": "RAG needs no index"} done'

    verdict = judge("q", [_hit("a")], "RAG needs no index [1].", Judge())
    assert verdict == {"supported": False, "unsupported": "RAG needs no index", "cited": True}

    class Broken:
        def stream(self, system, prompt):
            yield "no json here"

    assert judge("q", [], "plain", Broken())["supported"] is False
