"""Settings from environment variables (loaded from .env when present).

One frozen dataclass, read once. Defaults match the local Docker Compose + Ollama setup, so a
fresh clone works without editing anything.
"""

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    database_url: str
    ollama_url: str
    embed_model: str
    embed_dim: int
    llm_provider: str  # "ollama" or "anthropic"
    ollama_chat_model: str
    anthropic_model: str
    anthropic_api_key: str
    min_score: float  # confidence gate: refuse to answer below this top similarity
    top_k: int


def load_dotenv(path: Path = Path(".env")) -> None:
    """Minimal .env reader: KEY=VALUE lines; real environment variables win."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@lru_cache
def get_settings() -> Settings:
    load_dotenv()
    env = os.environ.get
    return Settings(
        database_url=env("DATABASE_URL", "postgresql://cairnly:cairnly@localhost:5434/cairnly"),
        ollama_url=env("OLLAMA_URL", "http://localhost:11434"),
        embed_model=env("EMBED_MODEL", "nomic-embed-text"),
        embed_dim=int(env("EMBED_DIM", "768")),
        llm_provider=env("LLM_PROVIDER", "ollama"),
        ollama_chat_model=env("OLLAMA_CHAT_MODEL", "qwen3:8b"),
        anthropic_model=env("ANTHROPIC_MODEL", "claude-opus-5-5"),
        anthropic_api_key=env("ANTHROPIC_API_KEY", ""),
        min_score=float(env("MIN_SCORE", "0.55")),
        top_k=int(env("TOP_K", "6")),
    )
