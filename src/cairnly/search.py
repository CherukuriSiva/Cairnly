"""Hybrid search: keyword (Postgres full-text) + meaning (pgvector), merged with RRF.

Keyword search finds exact terms ("RRF", "pgvector") that embeddings blur; vector search finds
paraphrases ("make answers cite sources") that keywords miss. Reciprocal Rank Fusion merges
the two ranked lists using only ranks, so their incomparable scores never need calibrating:

    rrf(chunk) = sum over lists of 1 / (K + rank in that list)

Keyword matching uses OR over the question's words (each word is optional; ts_rank_cd rewards
chunks that match more of them). Postgres AND-matching would drop any chunk missing one word.
"""

from collections.abc import Callable
from dataclasses import dataclass

import psycopg
from pgvector import Vector

from cairnly.embed import embed_query

RRF_K = 60  # the constant from the original RRF paper; dampens the gap between rank 1 and 2
CANDIDATES = 30  # how deep each list goes before fusion


@dataclass
class Hit:
    chunk_id: int
    title: str
    path: str
    trail: str
    start_line: int
    end_line: int
    text: str
    score: float = 0.0  # RRF score
    similarity: float | None = None  # cosine similarity, when the vector list found it

    @property
    def citation(self) -> str:
        where = f"{self.title} > {self.trail}" if self.trail else self.title
        return f"{where} ({self.path}:{self.start_line}-{self.end_line})"


@dataclass
class SearchResult:
    hits: list[Hit]
    top_similarity: float  # best cosine similarity seen; drives the confidence gate


SELECT = """SELECT c.id, d.title, d.path, c.trail, c.start_line, c.end_line, c.text"""

KEYWORD_SQL = """WITH q AS (
        SELECT replace(plainto_tsquery('english', %(q)s)::text, '&', '|')::tsquery AS query)
    """ + SELECT + """, 0.0
    FROM chunks c JOIN documents d ON d.id = c.document_id, q
    WHERE q.query::text <> '' AND c.tsv @@ q.query
    ORDER BY ts_rank_cd(c.tsv, q.query) DESC
    LIMIT %(n)s"""

VECTOR_SQL = SELECT + """, 1 - (c.embedding <=> %(v)s) AS similarity
    FROM chunks c JOIN documents d ON d.id = c.document_id
    ORDER BY c.embedding <=> %(v)s
    LIMIT %(n)s"""


def rrf(*ranked_lists: list[int], k: int = RRF_K) -> dict[int, float]:
    scores: dict[int, float] = {}
    for ranked in ranked_lists:
        for rank, chunk_id in enumerate(ranked, start=1):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1 / (k + rank)
    return scores


def search(conn: psycopg.Connection, query: str, top_k: int = 6,
           embedder: Callable[[str], list[float]] = embed_query) -> SearchResult:
    vector = Vector(embedder(query))
    keyword_rows = conn.execute(KEYWORD_SQL, {"q": query, "n": CANDIDATES}).fetchall()
    vector_rows = conn.execute(VECTOR_SQL, {"v": vector, "n": CANDIDATES}).fetchall()

    hits: dict[int, Hit] = {}
    for row in keyword_rows:
        hits.setdefault(row[0], Hit(*row[:7]))
    for row in vector_rows:
        hits.setdefault(row[0], Hit(*row[:7])).similarity = float(row[7])
    scores = rrf([r[0] for r in keyword_rows], [r[0] for r in vector_rows])
    for chunk_id, score in scores.items():
        hits[chunk_id].score = score

    ranked = sorted(hits.values(), key=lambda h: h.score, reverse=True)[:top_k]
    top_similarity = max((float(r[7]) for r in vector_rows), default=0.0)
    return SearchResult(ranked, top_similarity)
