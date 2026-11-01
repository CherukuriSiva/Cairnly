"""Check every production key and service without printing a secret.

The `check` job of the Modal API app (deploy/modal_api.py) runs this with the live secret. Each
result is a name, pass or fail, and a detail. A detail is a fixed phrase or a number (a status
code, a version, a model name), never a value from the settings or the environment, so the
report is safe to paste into a log or an issue. A failed call reports only the error's class
name, because an error message can carry a host name or a URL.

The checks:
- database: connects and finds the pgvector extension (installed, or available to install).
- ollama with token: GET /api/tags answers 200 and lists both models.
- ollama without token: must answer 401, which proves the proxy-auth lock is on.
- langfuse: GET /api/public/projects with the keys answers 200; skipped when the keys are unset.
"""

import base64
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass

import httpx

from cairnly.config import Settings, get_settings
from cairnly.db import connect
from cairnly.ollama import auth_headers

HTTP_TIMEOUT_S = 180  # the first call may wake the Ollama GPU container
LANGFUSE_DEFAULT_HOST = "https://cloud.langfuse.com"  # the SDK's own default

DbProbe = Callable[[], str | None]  # the pgvector version, or None when it is not available
HttpGet = Callable[[str, Mapping[str, str]], httpx.Response]  # (url, headers) -> response


@dataclass(frozen=True)
class Result:
    name: str
    ok: bool
    detail: str


def vector_version(url: str) -> str | None:
    """The installed pgvector version, else the version available to install, else None."""
    with connect(url) as conn:
        row = conn.execute("SELECT coalesce(installed_version, default_version) "
                           "FROM pg_available_extensions WHERE name = 'vector'").fetchone()
    return row[0] if row else None


def http_get(url: str, headers: Mapping[str, str]) -> httpx.Response:
    return httpx.get(url, headers=dict(headers), timeout=HTTP_TIMEOUT_S)


def check_database(probe: DbProbe) -> Result:
    try:
        version = probe()
    except Exception as exc:
        return Result("database", False, f"connection failed ({type(exc).__name__})")
    if version is None:
        return Result("database", False, "connected, but the vector extension is not available")
    return Result("database", True, f"connected, vector {version}")


def _get(get: HttpGet, url: str, headers: Mapping[str, str]) -> httpx.Response | str:
    """The response, or a fixed phrase naming the error class when the call failed."""
    try:
        return get(url, headers)
    except Exception as exc:
        return f"request failed ({type(exc).__name__})"


def _has_model(names: set[str], model: str) -> bool:
    return model in names or f"{model}:latest" in names


def check_ollama_with_token(s: Settings, get: HttpGet) -> Result:
    name = "ollama with token"
    headers = auth_headers(s)
    if not headers:
        return Result(name, False, "proxy-auth token not configured")
    response = _get(get, f"{s.ollama_url}/api/tags", headers)
    if isinstance(response, str):
        return Result(name, False, response)
    if response.status_code != 200:
        return Result(name, False, f"status {response.status_code}")
    names = {m.get("name", "") for m in response.json().get("models", [])}
    missing = [m for m in (s.ollama_chat_model, s.embed_model) if not _has_model(names, m)]
    if missing:
        return Result(name, False, f"status 200, missing {', '.join(missing)}")
    return Result(name, True, f"status 200, has {s.ollama_chat_model} and {s.embed_model}")


def check_ollama_without_token(s: Settings, get: HttpGet) -> Result:
    name = "ollama without token"
    response = _get(get, f"{s.ollama_url}/api/tags", {})
    if isinstance(response, str):
        return Result(name, False, response)
    if response.status_code != 401:
        return Result(name, False, f"status {response.status_code}: the proxy-auth lock is off")
    return Result(name, True, "status 401, locked")


def check_langfuse(env: Mapping[str, str], get: HttpGet) -> Result:
    public, secret = env.get("LANGFUSE_PUBLIC_KEY", ""), env.get("LANGFUSE_SECRET_KEY", "")
    if not (public and secret):
        return Result("langfuse", True, "skipped: not configured")
    host = env.get("LANGFUSE_HOST", "") or LANGFUSE_DEFAULT_HOST
    token = base64.b64encode(f"{public}:{secret}".encode()).decode()
    response = _get(get, f"{host.rstrip('/')}/api/public/projects",
                    {"Authorization": f"Basic {token}"})
    if isinstance(response, str):
        return Result("langfuse", False, response)
    return Result("langfuse", response.status_code == 200, f"status {response.status_code}")


def run_checks(s: Settings, probe: DbProbe, get: HttpGet, env: Mapping[str, str]) -> list[Result]:
    # With the token first: that call wakes the GPU container, the 401 comes from the proxy.
    return [check_database(probe), check_ollama_with_token(s, get),
            check_ollama_without_token(s, get), check_langfuse(env, get)]


def render(results: list[Result]) -> str:
    return "\n".join(f"{'PASS' if r.ok else 'FAIL'}  {r.name}: {r.detail}" for r in results)


def main() -> bool:
    """Run every check against the real services, print the report, return True if all pass."""
    s = get_settings()
    results = run_checks(s, lambda: vector_version(s.database_url), http_get, os.environ)
    print(render(results))
    return all(r.ok for r in results)
