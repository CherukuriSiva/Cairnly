"""Shared fixtures. Tests marked `db` use a throwaway schema in the Compose Postgres."""

import hashlib

import psycopg
import pytest

from cairnly.config import get_settings
from cairnly.db import connect, migrate

DIM = 768


def fake_vector(text: str) -> list[float]:
    """Deterministic stand-in for an embedding: same text, same vector; no Ollama needed."""
    digest = hashlib.sha256(text.encode()).digest()
    return [b / 255 for b in digest] * (DIM // len(digest))


@pytest.fixture
def fake_embedder():
    calls: list[str] = []

    def embedder(texts: list[str]) -> list[list[float]]:
        calls.extend(texts)
        return [fake_vector(t) for t in texts]

    embedder.calls = calls
    return embedder


@pytest.fixture
def conn():
    """A connection whose tables live in a fresh schema that is dropped afterwards."""
    try:
        admin = psycopg.connect(get_settings().database_url, autocommit=True)
    except psycopg.OperationalError:
        pytest.skip("Postgres not running: docker compose up -d db")
    schema = "test_" + hashlib.sha1(str(id(admin)).encode()).hexdigest()[:8]
    admin.execute("CREATE EXTENSION IF NOT EXISTS vector")
    admin.execute(f"CREATE SCHEMA {schema}")
    c = connect()
    c.execute(f"SET search_path TO {schema}, public")
    migrate(c, dim=DIM)
    yield c
    c.close()
    admin.execute(f"DROP SCHEMA {schema} CASCADE")
    admin.close()
