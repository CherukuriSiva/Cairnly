
import pytest

from cairnly.evals import (
    FOLLOWUPS_FILE,
    GoldenItem,
    check_gates,
    followup_report,
    gate_metrics,
    judge,
    lessons_golden,
    load_jsonl,
    off_topic_questions,
    retrieval_metrics,
    run_retrieval,
    suggest_min_score,
)
from cairnly.kb import ROOT
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


def test_lessons_golden_reads_mdx_quiz_lines(tmp_path):
    lesson = tmp_path / "lessons" / "ai-engineering" / "what-is-rag.mdx"
    lesson.parent.mkdir(parents=True)
    lesson.write_text("---\ntitle: RAG\n---\n\n<MiniQuiz>\n**Q: Why retrieve first?**\n\n"
                      "- A) speed\n- B) grounding \u2705\n</MiniQuiz>\n")

    [item] = lessons_golden(tmp_path)

    assert item.question == "Why retrieve first?"
    assert item.gold == {"lessons/ai-engineering/what-is-rag.mdx"}
    assert item.exclude_trails == ("Quick quiz",)


def test_real_content_has_a_quiz_question_per_lesson():
    items = lessons_golden(ROOT / "content")
    assert len(items) >= 126
    assert all(next(iter(i.gold)).endswith(".mdx") for i in items)


def test_off_topic_set_has_40_unique_questions():
    questions = off_topic_questions()
    assert len(questions) == 40 == len(set(questions))


def test_followup_set_is_well_formed_and_gold_lessons_exist():
    items = load_jsonl(FOLLOWUPS_FILE)
    assert len(items) == 15
    for item in items:
        assert item["history"] and item["followup"] and item["standalone"]
        for path in item["gold"]:
            assert (ROOT / "content" / path).is_file(), path


def test_followup_report_compares_rewritten_with_standalone():
    items = [
        {"id": "a", "history": [{"question": "q", "answer": "a"}], "followup": "and it?",
         "standalone": "good a", "gold": ["a.mdx"]},
        {"id": "b", "history": [{"question": "q", "answer": "a"}], "followup": "and that?",
         "standalone": "good b", "gold": ["b.mdx"]},
    ]
    paths = {"good a": "a.mdx", "good b": "b.mdx"}

    def search_fn(q):
        return SearchResult([_hit(paths.get(q, "other.mdx"))], 0.9)

    rewrites = {"and it?": "good a", "and that?": "something vague"}
    worse = followup_report(items, lambda q, h: rewrites[q], search_fn, k=5)
    assert (worse["standalone_recall@5"], worse["rewritten_recall@5"]) == (1.0, 0.5)
    assert worse["passed"] is False

    fixed = {"and it?": "good a", "and that?": "good b"}
    better = followup_report(items, lambda q, h: fixed[q], search_fn, k=5)
    assert better["rewritten_recall@5"] == 1.0 and better["passed"] is True


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


def test_redteam_report_counts_wrong_blocks_and_misses():
    from cairnly.evals import redteam_report
    from cairnly.guard import Verdict

    def check(text):  # a stand-in guard: blocks texts starting with "bad"
        return Verdict(True, "injection") if text.startswith("bad") else Verdict(False)

    rows = [{"text": "bad one", "label": "block", "rule": "injection"},
            {"text": "sneaky", "label": "block", "rule": "jailbreak"},
            {"text": "fine", "label": "allow"},
            {"text": "bad but legit", "label": "allow"}]
    report = redteam_report(rows, ["golden question", "off-topic question"], check=check)

    assert report["allowed_questions"] == 4 and report["attacks"] == 2
    assert report["false_block_rate"] == 0.25 and report["miss_rate"] == 0.5
    assert report["misses"] == ["sneaky"]
    assert report["false_blocks"] == [{"text": "bad but legit", "rule": "injection"}]
    assert report["per_rule"]["injection"] == {"attacks": 1, "caught": 1, "blocked": 2}
    assert report["per_rule"]["jailbreak"] == {"attacks": 1, "caught": 0, "blocked": 0}
    assert check_gates(report, {"false_block_rate": 0.02, "miss_rate": 0.10}) == [
        "false_block_rate = 0.25 is above the limit 0.02", "miss_rate = 0.5 is above the limit 0.1"]


def test_heldout_report_splits_rates_by_source():
    from cairnly.evals import heldout_report
    from cairnly.guard import Verdict

    def check(text):
        return Verdict(True, "injection") if text.startswith("bad") else Verdict(False)

    rows = [{"text": "bad a", "label": "block", "rule": "injection", "source": "fresh"},
            {"text": "sneaky", "label": "block", "rule": "injection", "source": "fresh"},
            {"text": "fine", "label": "allow", "source": "fresh"},
            {"text": "bad b", "label": "block", "rule": "injection", "source": "review-1"}]
    report = heldout_report(rows, check=check)

    assert report["miss_rate"] == round(1 / 3, 4) and report["false_block_rate"] == 0.0
    assert report["by_source"]["fresh"]["miss_rate"] == 0.5
    assert report["by_source"]["review-1"] == {"allowed_questions": 0, "attacks": 1,
                                               "false_block_rate": 0.0, "miss_rate": 0.0}


def test_heldout_set_is_well_formed_and_apart_from_the_tuning_set():
    from cairnly.evals import REDTEAM_FILE, REDTEAM_HELDOUT_FILE

    held = load_jsonl(REDTEAM_HELDOUT_FILE)
    assert len(held) >= 30
    assert {r["label"] for r in held} == {"block", "allow"}
    assert {r["source"] for r in held} == {"review-1", "fresh"}
    tuning = {r["text"] for r in load_jsonl(REDTEAM_FILE)}
    assert not tuning & {r["text"] for r in held}  # a row in both would not be held out


def test_redteam_set_is_well_formed():
    from cairnly.evals import REDTEAM_FILE

    rows = load_jsonl(REDTEAM_FILE)
    assert len(rows) >= 100
    assert {r["label"] for r in rows} == {"block", "allow"}
    rules = {r["rule"] for r in rows if r["label"] == "block"}
    assert rules == {"injection", "jailbreak", "prompt_extraction", "junk"}
