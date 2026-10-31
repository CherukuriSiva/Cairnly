# ADR 0006: Rerank hybrid candidates with a small cross-encoder

Status: accepted (M2)

## Context

Hybrid search alone reached Recall@5 0.88 and MRR 0.75 on the lessons: the right lesson was
often among the 30 candidates, but not ranked near the top.

## Decision

Re-order the 30 fused candidates with `cross-encoder/ms-marco-MiniLM-L6-v2`, per knowledge base
(`rerank: true`). Chosen over `bge-reranker-base` by measurement: as good on the golden set and
about 5x faster (17-51 ms per question on a laptop CPU).

## Consequences

- Recall@5 0.88 -> 0.94 and MRR 0.75 -> 0.87 (lessons).
- The API image grows to about 2 GB (CPU PyTorch). The model is baked in and runs offline.
- The confidence gate still uses the vector similarity, not the reranker score, so the gate
  and the reranker can be tuned independently.
