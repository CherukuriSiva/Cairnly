# ADR 0011: Raise the confidence gate to 0.70 for the full public content

Status: Superseded by [ADR 0016](0016-written-eval-set.md)

## Context

ADR 0005 set the cutoff to 0.67, measured with the other knowledge base's questions as
negatives. In M3 the other knowledge base is gone and all 162 pages are public, so the
lessons gate was measured again on 2026-11-01: 127 quiz questions as positives and 40
hand-written off-topic questions (`evals/off-topic.jsonl`: cooking, sport, travel, health,
gardening, money, music, history, pets, home repair) as negatives.

- Lowest on-topic best similarity: 0.730.
- Highest off-topic best similarity: 0.676 ("How often should I practise piano as a beginner?").
- At 0.67: 0% false refusals, 2.5% false accepts (1 of 40). `cairnly eval` suggested 0.676.

## Decision

Set `min_score` to 0.70 for `lessons`, near the middle of the gap between 0.676 and 0.730,
instead of the suggested 0.676, which sits right on the highest negative. The eval gate now
also checks `false_accept_rate` for lessons.

## Consequences

- Measured at 0.70: 0% false refusals and 0% false accepts, Recall@5 0.937, MRR 0.873.
- The margin is about 0.03 on each side. Quiz questions are clearer than real user questions,
  so a vague real question is more likely to be refused; add real refused questions to the
  eval as they appear and re-measure.
- The cutoff is still tied to the embedding model (`nomic-embed-text`).
