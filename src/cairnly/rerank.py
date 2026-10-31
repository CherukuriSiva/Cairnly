"""Second-stage reranking with a cross-encoder.

Hybrid search scores the question and each chunk separately (embeddings, keyword counts). A
cross-encoder reads the question and the chunk *together* and scores how well one answers
the other, which is more accurate but too slow to run over the whole corpus. So it only
re-orders the 30 fused candidates.

Measured on the lessons golden set (docs/LEARN-M2.md): ms-marco-MiniLM-L6-v2 lifted Recall@5
0.88 -> 0.94 for ~17-51 ms per question on a laptop CPU; the larger bge-reranker-base was both
slower and slightly worse here.

Optional: install with `uv sync --extra rerank`. Without it, search skips this step.
"""

import importlib.util
from functools import lru_cache

from cairnly.search import Hit

MODEL = "cross-encoder/ms-marco-MiniLM-L6-v2"


def available() -> bool:
    return importlib.util.find_spec("sentence_transformers") is not None


@lru_cache(maxsize=2)
def _model(name: str):
    from sentence_transformers import CrossEncoder

    return CrossEncoder(name)


def rerank(question: str, hits: list[Hit], model: str = MODEL) -> list[Hit]:
    """Return `hits` ordered by cross-encoder relevance (best first)."""
    if len(hits) < 2:
        return hits
    pairs = [(question, f"{h.title} > {h.trail}\n{h.text}" if h.trail else f"{h.title}\n{h.text}")
             for h in hits]
    scores = _model(model).predict(pairs)
    order = sorted(range(len(hits)), key=lambda i: float(scores[i]), reverse=True)
    return [hits[i] for i in order]
