"""Text embeddings from an Ollama model (local, or the Modal GPU in production).

nomic-embed-text is trained with task prefixes: documents get "search_document: " and queries
get "search_query: ". Leaving them out quietly lowers retrieval quality, so they live here and
callers never add them by hand.
"""

from cairnly.config import get_settings
from cairnly.ollama import ollama_client

DOC_PREFIX = "search_document: "
QUERY_PREFIX = "search_query: "
TIMEOUT_S = 120  # above the 90 s first-token limit, so a cold GPU start is covered here too


def embed(texts: list[str], batch: int = 32) -> list[list[float]]:
    s = get_settings()
    vectors: list[list[float]] = []
    with ollama_client(s, TIMEOUT_S) as client:
        for i in range(0, len(texts), batch):
            resp = client.post("/api/embed", json={"model": s.embed_model,
                                                    "input": texts[i:i + batch]})
            resp.raise_for_status()
            vectors += resp.json()["embeddings"]
    return vectors


def embed_documents(texts: list[str]) -> list[list[float]]:
    return embed([DOC_PREFIX + t for t in texts])


def embed_query(text: str) -> list[float]:
    return embed([QUERY_PREFIX + text])[0]
