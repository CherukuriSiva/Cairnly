"""Settings from environment variables (loaded from .env when present).

One frozen dataclass, read once. Defaults match the local Docker Compose + Ollama setup, so a
fresh clone works without editing anything.
"""

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote


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


def database_url() -> str:
    """DATABASE_URL, or one built from DB_HOST/DB_USER/DB_PASSWORD/DB_NAME.

    Cloud platforms hand out credentials as separate secret fields (AWS RDS puts the password
    in Secrets Manager), so production sets the parts and never writes the full URL anywhere.
    """
    if url := os.environ.get("DATABASE_URL"):
        return url
    if host := os.environ.get("DB_HOST"):
        user = quote(os.environ.get("DB_USER", "cairnly"), safe="")
        password = quote(os.environ.get("DB_PASSWORD", ""), safe="")
        port = os.environ.get("DB_PORT", "5432")
        name = os.environ.get("DB_NAME", "cairnly")
        ssl = os.environ.get("DB_SSLMODE", "require")
        return f"postgresql://{user}:{password}@{host}:{port}/{name}?sslmode={ssl}"
    return "postgresql://cairnly:cairnly@localhost:5434/cairnly"


@lru_cache
def get_settings() -> Settings:
    load_dotenv()
    env = os.environ.get
    return Settings(
        database_url=database_url(),
        ollama_url=env("OLLAMA_URL", "http://localhost:11434"),
        embed_model=env("EMBED_MODEL", "nomic-embed-text"),
        embed_dim=int(env("EMBED_DIM", "768")),
        llm_provider=env("LLM_PROVIDER", "ollama"),
        ollama_chat_model=env("OLLAMA_CHAT_MODEL", "qwen3:8b"),
        anthropic_model=env("ANTHROPIC_MODEL", "claude-opus-5-5"),
        anthropic_api_key=env("ANTHROPIC_API_KEY", ""),
        top_k=int(env("TOP_K", "6")),
    )
