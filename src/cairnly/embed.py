"""Text embeddings from a local Ollama model.

nomic-embed-text is trained with task prefixes: documents get "search_document: " and queries
get "search_query: ". Leaving them out quietly lowers retrieval quality, so they live here and
callers never add them by hand.
"""

import httpx

from cairnly.config import get_settings

DOC_PREFIX = "search_document: "
QUERY_PREFIX = "search_query: "


def embed(texts: list[str], batch: int = 32) -> list[list[float]]:
    s = get_settings()
    vectors: list[list[float]] = []
    with httpx.Client(base_url=s.ollama_url, timeout=120) as client:
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
