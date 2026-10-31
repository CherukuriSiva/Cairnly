"""Settings from environment variables (loaded from .env when present).

One frozen dataclass, read once. Defaults match the local Docker Compose + Ollama setup, so a
fresh clone works without editing anything.

Claude is local only. The Claude provider needs ALLOW_ANTHROPIC=true, and a production server
refuses to start with it, so no public deploy can ever call Claude. The check fails closed:
CAIRNLY_ENV counts as production unless it is "development" or "test" (any case, spaces
ignored), so "Production", "prod" or a typo can never let Claude through.
cairnly never reads the Anthropic key itself: the SDK picks it up from the developer's shell.
"""

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

TRUE_WORDS = ("1", "true", "yes")
NON_PRODUCTION = ("development", "test")  # every other CAIRNLY_ENV value means production


@dataclass(frozen=True)
class Settings:
    database_url: str
    ollama_url: str
    embed_model: str
    embed_dim: int
    llm_provider: str  # "ollama" or "anthropic" (local only)
    ollama_chat_model: str
    anthropic_model: str
    top_k: int
    environment: str = "development"  # lowercased; "production" on the public deploy
    allow_anthropic: bool = False  # the Claude provider; never true in production
    cors_origins: tuple[str, ...] = ("http://localhost:3010",)
    trust_proxy: bool = False  # trust the last X-Forwarded-For entry (we sit behind one proxy)
    rate_limit_per_minute: int = 10  # per client IP, /ask and /search together
    rate_limit_per_day: int = 200
    global_answers_per_day: int = 2000  # /ask, all clients together
    max_concurrent_answers: int = 4
    first_token_timeout_s: float = 90  # covers a cold GPU start
    answer_timeout_s: float = 60  # measured from the first token
    trace_content: bool = False  # put question and answer text into traces (local only)
    modal_proxy_token_id: str = ""  # Modal proxy-auth token for the hosted Ollama
    modal_proxy_token_secret: str = ""


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


def flag(name: str) -> bool:
    """True only for 1, true or yes (any case), so a typo never switches a feature on."""
    return os.environ.get(name, "").strip().lower() in TRUE_WORDS


def is_production(s: Settings) -> bool:
    return s.environment not in NON_PRODUCTION


def validate(s: Settings) -> Settings:
    """Refuse settings that would let a server call Claude when it must not."""
    if is_production(s) and s.allow_anthropic:
        raise ValueError(f"ALLOW_ANTHROPIC must not be set when CAIRNLY_ENV=production "
                         f"(CAIRNLY_ENV={s.environment!r} counts as production; only "
                         f"{' or '.join(NON_PRODUCTION)} do not): the Claude API is for local "
                         f"development only")
    if s.llm_provider == "anthropic" and not s.allow_anthropic:
        raise ValueError("LLM_PROVIDER=anthropic needs ALLOW_ANTHROPIC=true "
                         "(local development only)")
    return s


@lru_cache
def get_settings() -> Settings:
    load_dotenv()
    env = os.environ.get
    origins = env("CORS_ORIGINS", "http://localhost:3010")
    return validate(Settings(
        database_url=database_url(),
        ollama_url=env("OLLAMA_URL", "http://localhost:11434"),
        embed_model=env("EMBED_MODEL", "nomic-embed-text"),
        embed_dim=int(env("EMBED_DIM", "768")),
        llm_provider=env("LLM_PROVIDER", "ollama"),
        ollama_chat_model=env("OLLAMA_CHAT_MODEL", "qwen3:8b"),
        anthropic_model=env("ANTHROPIC_MODEL", "claude-opus-5-5"),
        top_k=int(env("TOP_K", "6")),
        environment=env("CAIRNLY_ENV", "development").strip().lower(),
        allow_anthropic=flag("ALLOW_ANTHROPIC"),
        cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
        trust_proxy=flag("TRUST_PROXY"),
        rate_limit_per_minute=int(env("RATE_LIMIT_PER_MINUTE", "10")),
        rate_limit_per_day=int(env("RATE_LIMIT_PER_DAY", "200")),
        global_answers_per_day=int(env("GLOBAL_ANSWERS_PER_DAY", "2000")),
        max_concurrent_answers=int(env("MAX_CONCURRENT_ANSWERS", "4")),
        first_token_timeout_s=float(env("FIRST_TOKEN_TIMEOUT_S", "90")),
        answer_timeout_s=float(env("ANSWER_TIMEOUT_S", "60")),
        trace_content=flag("TRACE_CONTENT"),
        modal_proxy_token_id=env("MODAL_PROXY_TOKEN_ID", ""),
        modal_proxy_token_secret=env("MODAL_PROXY_TOKEN_SECRET", ""),
    ))
