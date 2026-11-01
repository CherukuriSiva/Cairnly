"""Measure answer quality on golden sets: questions whose right sources are known.

Golden set, one combined list reported as a whole and per source:
- quiz: each lesson's quiz question; gold = that lesson. The quiz section itself is
  excluded from results ("answer key left out"), so retrieval must find the teaching sections.
- written: 3 to 5 learner questions per lesson in the knowledge base's `questions` folder
  (evals/questions/<track>.jsonl), written in our own words; gold = the lesson that answers it
  (plus `section`, the heading that answers it, checked by a test but not used in scoring).
  The same quiz exclusion applies.

Metrics:
- Recall@k         share of questions with a gold source in the top k results
- MRR              mean of 1/rank of the first gold source (0 when not in the candidates)
- false refusals   on-topic questions the confidence gate refused
- false accepts    off-topic questions the gate let through. They come from
                   evals/off-topic.jsonl (cooking, sport, travel, ...: nothing the lessons
                   cover), plus the golden questions of any other knowledge base present
- faithfulness     (--judge) share of answers an LLM judge finds fully supported by sources

Red team (`cairnly eval-redteam`): the input guard (guard.py) on evals/redteam.jsonl, attacks
labelled "block" and tricky but legitimate questions labelled "allow". Every golden question
(quiz and written) and off-topic question must pass the guard too (the off-topic ones are
refused later by the confidence gate, not by the guard). No database and no model are needed,
so CI runs it.
- false-block rate  legitimate questions the guard blocked
- miss rate         attacks the guard let through
The rules were tuned on that set, so its rates flatter the guard. evals/redteam-heldout.jsonl
holds rows that were never used for tuning; its rates are reported next to the tuning ones (not
gated), as the honest estimate of how the guard does on text it has not seen.

Follow-ups (`cairnly eval-followups`): for each item in evals/followups.jsonl, recall@k of
searching with the hand-written standalone question vs. with the follow-up rewritten by the
LLM (rewrite.py). Rewriting passes when it is at least as good as the standalone baseline.
"""

import json
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from cairnly.guard import Verdict, check_input
from cairnly.kb import ROOT, KnowledgeBase, get_kb, load_kbs
from cairnly.mdx import section_titles
from cairnly.search import Hit, SearchResult

CANDIDATES = 30
QUIZ = re.compile(r"^\*\*Q:\s*(.+?)\*\*\s*$", re.M)
OFF_TOPIC_FILE = ROOT / "evals" / "off-topic.jsonl"
FOLLOWUPS_FILE = ROOT / "evals" / "followups.jsonl"
REDTEAM_FILE = ROOT / "evals" / "redteam.jsonl"
REDTEAM_HELDOUT_FILE = ROOT / "evals" / "redteam-heldout.jsonl"


@dataclass(frozen=True)
class GoldenItem:
    id: str
    question: str
    gold: frozenset[str]  # document paths that count as correct
    exclude_trails: tuple[str, ...] = ()
    source: str = "quiz"  # "quiz" (lesson quiz lines) or "written" (evals/questions)


@dataclass
class ItemResult:
    item: GoldenItem
    rank: int | None  # 1-based rank of the first gold hit, None if not found
    top_similarity: float
    hits: list[Hit] = field(default_factory=list)


# ---- golden sets -------------------------------------------------------------------------

def lessons_golden(corpus: Path, root: Path | None = None) -> list[GoldenItem]:
    """Quiz questions in the .md/.mdx files under `corpus`; gold paths are relative to `root`,
    the folder that was ingested (so a subset like content/lessons still matches paths stored
    as lessons/...). The quiz section (its title from content/sections.json) is excluded."""
    quiz_title = section_titles()["MiniQuiz"]
    items = []
    paths = (p for p in corpus.rglob("*") if p.suffix in (".md", ".mdx") and p.is_file())
    for path in sorted(paths):
        rel = path.resolve().relative_to((root or corpus).resolve()).as_posix()
        for n, question in enumerate(QUIZ.findall(path.read_text())):
            items.append(GoldenItem(f"{rel}#q{n}", question.strip(), frozenset([rel]),
                                    exclude_trails=(quiz_title,)))
    return items


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def off_topic_questions(path: Path = OFF_TOPIC_FILE) -> list[str]:
    """Questions the lessons must NOT answer; they measure the false-accept rate."""
    return [row["question"] for row in load_jsonl(path)]


def written_golden(directory: Path) -> list[GoldenItem]:
    """Written questions from the *.jsonl files in `directory`, one {"id", "question", "gold",
    "section"} row per line; gold paths are relative to the ingested folder, like the quiz's."""
    quiz_title = section_titles()["MiniQuiz"]
    return [GoldenItem(row["id"], row["question"], frozenset(row["gold"]),
                       exclude_trails=(quiz_title,), source="written")
            for path in sorted(directory.glob("*.jsonl")) for row in load_jsonl(path)]


def golden_for(kb: KnowledgeBase, path: str | None = None) -> list[GoldenItem]:
    """Quiz questions (from `path`, else the KB's folder), then the KB's written questions."""
    items = lessons_golden(Path(path or kb.path), root=Path(kb.path))
    if kb.questions:
        items += written_golden(ROOT / kb.questions)
    return items


# ---- metrics -------------------------------------------------------------------------------

def run_retrieval(items: list[GoldenItem],
                  search_fn: Callable[[str], SearchResult]) -> list[ItemResult]:
    results = []
    for item in items:
        result = search_fn(item.question)
        hits = [h for h in result.hits if h.trail.split(" > ")[0] not in item.exclude_trails]
        rank = next((n for n, h in enumerate(hits, start=1) if h.path in item.gold), None)
        results.append(ItemResult(item, rank, result.top_similarity, hits))
    return results


def retrieval_metrics(results: list[ItemResult], k: int) -> dict:
    n = len(results) or 1
    return {
        "questions": len(results),
        f"recall@{k}": round(sum(r.rank is not None and r.rank <= k for r in results) / n, 4),
        "mrr": round(sum(1 / r.rank for r in results if r.rank) / n, 4),
    }


def gate_rates(on_topic: list[float], off_topic: list[float], min_score: float) -> dict:
    """How the confidence gate behaves: refusing real questions vs. accepting foreign ones."""
    refused = sum(s < min_score for s in on_topic)
    accepted = sum(s >= min_score for s in off_topic)
    return {
        "min_score": min_score,
        "false_refusal_rate": round(refused / max(len(on_topic), 1), 4),
        "false_accept_rate": round(accepted / max(len(off_topic), 1), 4),
    }


def gate_metrics(on_topic: list[float], off_topic: list[float], min_score: float) -> dict:
    """The gate's rates at `min_score`, the suggested cutoff, and the rates at that cutoff
    rounded to 2 decimals (the value kbs.yaml would carry)."""
    suggested = suggest_min_score(on_topic, off_topic)
    return {
        **gate_rates(on_topic, off_topic, min_score),
        "suggested_min_score": suggested,
        "at_suggested": (None if suggested is None
                         else gate_rates(on_topic, off_topic, round(suggested, 2))),
    }


def suggest_min_score(on_topic: list[float], off_topic: list[float]) -> float | None:
    """The cutoff that minimizes false refusals + false accepts (equal weight)."""
    if not on_topic or not off_topic:
        return None
    candidates = sorted(set(round(s, 3) for s in on_topic + off_topic))
    errors = lambda t: sum(s < t for s in on_topic) + sum(s >= t for s in off_topic)  # noqa: E731
    return min(candidates, key=errors)


def by_source(results: list[ItemResult], off_topic: list[float], k: int,
              min_score: float) -> dict:
    """Retrieval and gate metrics per golden source (quiz, written), each source's
    similarities against the same off-topic ones."""
    report = {}
    for source in sorted({r.item.source for r in results}):
        part = [r for r in results if r.item.source == source]
        report[source] = {**retrieval_metrics(part, k),
                          **gate_metrics([r.top_similarity for r in part], off_topic,
                                         min_score)}
    return report


def check_gates(report: dict, thresholds: dict) -> list[str]:
    """Return a failure message per metric below its minimum (or above its maximum)."""
    failures = []
    for metric, limit in thresholds.items():
        value = report.get(metric)
        if metric.endswith("_rate") or metric.startswith("max_"):
            name = metric.removeprefix("max_")
            value = report.get(name, value)
            if value is not None and value > limit:
                failures.append(f"{name} = {value} is above the limit {limit}")
        elif value is not None and value < limit:
            failures.append(f"{metric} = {value} is below the minimum {limit}")
    return failures


# ---- follow-up rewriting ----------------------------------------------------------------------

def followup_report(items: list[dict], rewrite_fn: Callable[[str, list[dict]], str],
                    search_fn: Callable[[str], SearchResult], k: int) -> dict:
    """Recall@k of the hand-written standalone question vs. the rewritten follow-up.

    Each item: {"id", "history": [{"question", "answer"}], "followup", "standalone", "gold"}.
    """
    def found(query: str, gold: set[str]) -> bool:
        return any(h.path in gold for h in search_fn(query).hits[:k])

    rows = []
    for item in items:
        gold = set(item["gold"])
        rewritten = rewrite_fn(item["followup"], item["history"])
        rows.append({"id": item["id"], "rewritten": rewritten,
                     "standalone_found": found(item["standalone"], gold),
                     "rewritten_found": found(rewritten, gold)})
    n = len(rows) or 1
    standalone = round(sum(r["standalone_found"] for r in rows) / n, 4)
    rewritten = round(sum(r["rewritten_found"] for r in rows) / n, 4)
    return {"questions": len(rows), f"standalone_recall@{k}": standalone,
            f"rewritten_recall@{k}": rewritten, "passed": rewritten >= standalone,
            "rows": rows}


# ---- red team ---------------------------------------------------------------------------------

def redteam_report(rows: list[dict], also_allowed: list[str],
                   check: Callable[[str], Verdict] = check_input) -> dict:
    """How the input guard does on labelled rows plus extra questions that must pass.

    Each row: {"text", "label": "block" | "allow", "rule"?}. Per rule: how many attacks it
    should catch, how many were caught, and how many texts it blocked in total.
    """
    allowed = [r["text"] for r in rows if r["label"] == "allow"] + also_allowed
    attacks = [r for r in rows if r["label"] == "block"]
    false_blocks = [(t, check(t).rule) for t in allowed if check(t).blocked]
    verdicts = [(r, check(r["text"])) for r in attacks]
    misses = [r["text"] for r, v in verdicts if not v.blocked]
    per_rule: dict[str, dict] = {}

    def counts(rule: str | None) -> dict:
        return per_rule.setdefault(rule or "?", {"attacks": 0, "caught": 0, "blocked": 0})

    for r, v in verdicts:
        counts(r.get("rule"))["attacks"] += 1
        counts(r.get("rule"))["caught"] += v.blocked
        if v.blocked:
            counts(v.rule)["blocked"] += 1
    for _, rule in false_blocks:
        counts(rule)["blocked"] += 1
    return {
        "allowed_questions": len(allowed),
        "attacks": len(attacks),
        "false_block_rate": round(len(false_blocks) / max(len(allowed), 1), 4),
        "miss_rate": round(len(misses) / max(len(attacks), 1), 4),
        "per_rule": per_rule,
        "false_blocks": [{"text": t, "rule": rule} for t, rule in false_blocks],
        "misses": misses,
    }


def heldout_report(rows: list[dict],
                   check: Callable[[str], Verdict] = check_input) -> dict:
    """The red-team report on rows never used for tuning, plus the two rates per row `source`."""
    report = redteam_report(rows, [], check)
    sources = sorted({r.get("source", "") for r in rows})
    if len(sources) > 1:
        report["by_source"] = {}
        for source in sources:
            part = redteam_report([r for r in rows if r.get("source", "") == source], [], check)
            report["by_source"][source] = {k: part[k] for k in
                                           ("allowed_questions", "attacks", "false_block_rate",
                                            "miss_rate")}
    return report


# ---- faithfulness (LLM as judge) ------------------------------------------------------------

JUDGE_SYSTEM = """You grade whether an ANSWER is supported by the SOURCES.
Reply with JSON only:
{"supported": true|false, "unsupported": "<the first unsupported claim, or empty>"}.
"supported" is true only if every factual claim in the answer is stated in or directly implied
by the sources. A plain "the sources don't say" answer counts as supported."""


def judge(question: str, hits: list[Hit], answer_text: str, llm) -> dict:
    sources = "\n\n".join(f"[{n}] {h.text}" for n, h in enumerate(hits, start=1))
    prompt = f"SOURCES:\n{sources}\n\nQUESTION: {question}\n\nANSWER:\n{answer_text}"
    raw = "".join(llm.stream(JUDGE_SYSTEM, prompt))
    match = re.search(r"\{.*\}", raw, re.S)
    try:
        verdict = json.loads(match.group(0)) if match else {}
    except json.JSONDecodeError:
        verdict = {}
    return {"supported": bool(verdict.get("supported")),
            "unsupported": verdict.get("unsupported", ""),
            "cited": bool(re.search(r"\[\d+\]", answer_text))}


def faithfulness(results: list[ItemResult], kb: KnowledgeBase, llm, judge_llm,
                 top_k: int) -> dict:
    from cairnly.answer import build_prompt
    from cairnly.kb import load_prompt

    verdicts = []
    for r in results:
        if r.top_similarity < kb.min_score:
            continue  # refused: nothing to judge
        hits = r.hits[:top_k]
        text = "".join(llm.stream(load_prompt(kb.prompt), build_prompt(r.item.question, hits)))
        verdicts.append({"id": r.item.id, **judge(r.item.question, hits, text, judge_llm)})
    n = len(verdicts) or 1
    return {
        "judged": len(verdicts),
        "faithfulness": round(sum(v["supported"] for v in verdicts) / n, 4),
        "citation_rate": round(sum(v["cited"] for v in verdicts) / n, 4),
        "unsupported_examples": [v for v in verdicts if not v["supported"]][:5],
    }


# ---- CLI ------------------------------------------------------------------------------------

def main(args) -> None:
    from cairnly.config import get_settings
    from cairnly.db import connect
    from cairnly.llm import get_llm
    from cairnly.search import search_kb

    kb = get_kb(args.kb)
    items = golden_for(kb, args.golden)[: args.limit]
    others = [o for o in load_kbs().values() if o.name != kb.name and _available(o)]
    foreign = off_topic_questions() + [i.question for o in others for i in golden_for(o)]

    with connect() as conn:
        fn = lambda q: search_kb(conn, q, kb, top_k=CANDIDATES)  # noqa: E731
        results = run_retrieval(items, fn)
        off_topic = [fn(q).top_similarity for q in foreign]

    from cairnly import rerank

    report = {"kb": kb.name, "prompt_version": kb.prompt,
              "reranker": rerank.MODEL if kb.rerank and rerank.available() else None,
              **retrieval_metrics(results, args.k),
              **gate_metrics([r.top_similarity for r in results], off_topic, kb.min_score),
              "by_source": by_source(results, off_topic, args.k, kb.min_score)}
    if args.judge:
        llm = get_llm()
        report.update(faithfulness(results, kb, llm, llm, get_settings().top_k))

    # Lists for review, written to --out only: every miss, refused question and accepted
    # off-topic question.
    report["misses"] = [{"id": r.item.id, "question": r.item.question, "rank": r.rank,
                         "got": [h.path for h in r.hits[:3]]}
                        for r in results if r.rank is None or r.rank > args.k]
    report["false_refusals"] = [{"id": r.item.id, "question": r.item.question,
                                 "top_similarity": r.top_similarity}
                                for r in results if r.top_similarity < kb.min_score]
    report["false_accepts"] = [{"question": q, "top_similarity": s}
                               for q, s in zip(foreign, off_topic, strict=True)
                               if s >= kb.min_score]
    lists = ("misses", "false_refusals", "false_accepts")
    print(json.dumps({k: v for k, v in report.items() if k not in lists}, indent=2))
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2) + "\n")

    if args.gate:
        apply_gate(report, Path(args.gate), kb.name)


def apply_gate(report: dict, gate_file: Path, section: str) -> None:
    """Exit 1 (failing CI) when a metric breaks its limit in `section` of the gates file."""
    thresholds = (yaml.safe_load(gate_file.read_text()) or {}).get(section, {})
    failures = check_gates(report, thresholds)
    for failure in failures:
        print(f"EVAL GATE FAILED: {failure}", file=sys.stderr)
    if failures:
        sys.exit(1)
    print(f"eval gate passed ({len(thresholds)} checks)")


def followups_main(args) -> None:
    """Local only: needs a chat model for the rewrite step."""
    from cairnly.db import connect
    from cairnly.llm import get_llm
    from cairnly.rewrite import rewrite_question
    from cairnly.search import search_kb

    kb, llm = get_kb(args.kb), get_llm(args.provider)
    items = load_jsonl(Path(args.golden))
    with connect() as conn:
        report = followup_report(
            items, lambda q, history: rewrite_question(q, history, llm),
            lambda q: search_kb(conn, q, kb, top_k=CANDIDATES), args.k)
    print(json.dumps({"model": llm.name, **report}, indent=2))
    if not report["passed"]:
        print("FOLLOW-UP EVAL FAILED: rewritten recall is below the standalone baseline",
              file=sys.stderr)
        sys.exit(1)


def redteam_main(args) -> None:
    """The guard on the red-team set plus every golden and off-topic question (no DB, no model)."""
    kb = get_kb(args.kb)
    also_allowed = [i.question for i in golden_for(kb)] + off_topic_questions()
    report = redteam_report(load_jsonl(Path(args.golden)), also_allowed)
    if args.heldout:  # reported next to the tuning rates; the gate reads only the tuning ones
        report["heldout"] = heldout_report(load_jsonl(Path(args.heldout)))
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"tuning set:   false_block_rate {report['false_block_rate']} "
          f"({report['allowed_questions']} questions), miss_rate {report['miss_rate']} "
          f"({report['attacks']} attacks)")
    if "heldout" in report:
        held = report["heldout"]
        print(f"held-out set: false_block_rate {held['false_block_rate']} "
              f"({held['allowed_questions']} questions), miss_rate {held['miss_rate']} "
              f"({held['attacks']} attacks), not gated")
    if args.gate:
        apply_gate(report, Path(args.gate), "redteam")


def _available(kb: KnowledgeBase) -> bool:
    return Path(kb.path).exists()
