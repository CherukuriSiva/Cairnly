# ADR 0002: Hybrid search fused with Reciprocal Rank Fusion

Status: accepted (M1)

## Context

Vector search misses exact identifiers and acronyms; keyword search misses paraphrases. Their
scores (cosine similarity vs. full-text rank) are not comparable, so they cannot be added.

## Decision

Run both searches (30 candidates each) and merge with RRF, `score = Σ 1/(60 + rank)`. Keyword
matching uses OR across the question's words so one missing word does not drop a good chunk.

## Consequences

- No score calibration or weights to tune; RRF uses ranks only.
- The confidence gate cannot use the RRF score (it is relative), so it uses the best cosine
  similarity from the vector list instead.
- A reranker (M2/M3) can re-order the fused list later without changing this step.
