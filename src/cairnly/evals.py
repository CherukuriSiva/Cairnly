"""Measure answer quality on golden sets: questions whose right sources are known.

Golden set (no invented questions; it comes from the lessons themselves):
- lessons: each lesson's quiz question; gold = that lesson. The quiz section itself is
  excluded from results ("answer key left out"), so retrieval must find the teaching sections.

Metrics:
- Recall@k         share of questions with a gold source in the top k results
- MRR              mean of 1/rank of the first gold source (0 when not in the candidates)
- false refusals   on-topic questions the confidence gate refused
- false accepts    questions from the OTHER knowledge bases that the gate let through
- faithfulness     (--judge) share of answers an LLM judge finds fully supported by sources
"""

import json
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from cairnly.kb import KnowledgeBase, get_kb, load_kbs
from cairnly.search import Hit, SearchResult

CANDIDATES = 30
QUIZ = re.compile(r"^\*\*Q:\s*(.+?)\*\*\s*$", re.M)


@dataclass(frozen=True)
class GoldenItem:
    id: str
    question: str
    gold: frozenset[str]  # document paths that count as correct
    exclude_trails: tuple[str, ...] = ()


@dataclass
class ItemResult:
    item: GoldenItem
    rank: int | None  # 1-based rank of the first gold hit, None if not found
    top_similarity: float
    hits: list[Hit] = field(default_factory=list)


# ---- golden sets -------------------------------------------------------------------------

def lessons_golden(corpus: Path, root: Path | None = None) -> list[GoldenItem]:
    """Quiz questions under `corpus`; gold paths are relative to `root`, the folder that was
    ingested (so a subset like corpus/public still matches paths stored as public/...)."""
    items = []
    for path in sorted(corpus.rglob("*.md")):
        rel = path.resolve().relative_to((root or corpus).resolve()).as_posix()
        for n, question in enumerate(QUIZ.findall(path.read_text())):
            items.append(GoldenItem(f"{rel}#q{n}", question.strip(), frozenset([rel]),
                                    exclude_trails=("Quick quiz",)))
    return items


def golden_for(kb: KnowledgeBase, path: str | None = None) -> list[GoldenItem]:
    return lessons_golden(Path(path or kb.path), root=Path(kb.path))


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


def gate_metrics(on_topic: list[float], off_topic: list[float], min_score: float) -> dict:
    """How the confidence gate behaves: refusing real questions vs. accepting foreign ones."""
    refused = sum(s < min_score for s in on_topic)
    accepted = sum(s >= min_score for s in off_topic)
    return {
        "min_score": min_score,
        "false_refusal_rate": round(refused / max(len(on_topic), 1), 4),
        "false_accept_rate": round(accepted / max(len(off_topic), 1), 4),
        "suggested_min_score": suggest_min_score(on_topic, off_topic),
    }


def suggest_min_score(on_topic: list[float], off_topic: list[float]) -> float | None:
    """The cutoff that minimizes false refusals + false accepts (equal weight)."""
    if not on_topic or not off_topic:
        return None
    candidates = sorted(set(round(s, 3) for s in on_topic + off_topic))
    errors = lambda t: sum(s < t for s in on_topic) + sum(s >= t for s in off_topic)  # noqa: E731
    return min(candidates, key=errors)


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
    foreign = [i for o in others for i in golden_for(o)][: max(len(items), 1)]

    with connect() as conn:
        fn = lambda q: search_kb(conn, q, kb, top_k=CANDIDATES)  # noqa: E731
        results = run_retrieval(items, fn)
        off_topic = [fn(i.question).top_similarity for i in foreign]

    from cairnly import rerank

    report = {"kb": kb.name, "prompt_version": kb.prompt,
              "reranker": rerank.MODEL if kb.rerank and rerank.available() else None,
              **retrieval_metrics(results, args.k),
              **gate_metrics([r.top_similarity for r in results], off_topic, kb.min_score)}
    if args.judge:
        llm = get_llm()
        report.update(faithfulness(results, kb, llm, llm, get_settings().top_k))

    report["misses"] = [{"id": r.item.id, "question": r.item.question,
                         "got": [h.path for h in r.hits[:3]]}
                        for r in results if r.rank is None or r.rank > args.k][:10]
    print(json.dumps({k: v for k, v in report.items() if k != "misses"}, indent=2))
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2) + "\n")

    if args.gate:
        thresholds = (yaml.safe_load(Path(args.gate).read_text()) or {}).get(kb.name, {})
        failures = check_gates(report, thresholds)
        for failure in failures:
            print(f"EVAL GATE FAILED: {failure}", file=sys.stderr)
        if failures:
            sys.exit(1)
        print(f"eval gate passed ({len(thresholds)} checks)")


def _available(kb: KnowledgeBase) -> bool:
    return Path(kb.path).exists()
