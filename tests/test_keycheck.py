import dataclasses

import httpx

from cairnly.config import get_settings
from cairnly.keycheck import render, run_checks

PASSWORD = "fake-db-password-123"
TOKEN_ID = "wk-fake-token-id"
TOKEN_SECRET = "ws-fake-token-secret"
LF_PUBLIC = "pk-lf-fake-public"
LF_SECRET = "sk-lf-fake-secret"
OLLAMA = "https://ollama.example"
MODELS = {"models": [{"name": "qwen3:8b"}, {"name": "nomic-embed-text:latest"}]}
LANGFUSE_ENV = {"LANGFUSE_PUBLIC_KEY": LF_PUBLIC, "LANGFUSE_SECRET_KEY": LF_SECRET,
                "LANGFUSE_HOST": "https://langfuse.example"}


def settings(**changes):
    return dataclasses.replace(
        get_settings(), database_url=f"postgresql://cairnly:{PASSWORD}@db.example/cairnly",
        ollama_url=OLLAMA, ollama_chat_model="qwen3:8b", embed_model="nomic-embed-text",
        modal_proxy_token_id=TOKEN_ID, modal_proxy_token_secret=TOKEN_SECRET, **changes)


def fake_get(locked: bool = True):
    """A stand-in for the HTTP getter: Ollama answers 401 without the token when locked."""
    calls: list[tuple[str, dict]] = []

    def get(url, headers):
        calls.append((url, dict(headers)))
        if url.startswith(OLLAMA):
            if locked and headers.get("Modal-Secret") != TOKEN_SECRET:
                return httpx.Response(401)
            return httpx.Response(200, json=MODELS)
        return httpx.Response(200, json={"data": []})

    get.calls = calls
    return get


def by_name(results):
    return {r.name: r for r in results}


def test_all_pass():
    results = run_checks(settings(), lambda: "0.8.6", fake_get(), LANGFUSE_ENV)

    assert all(r.ok for r in results)
    assert by_name(results)["database"].detail == "connected, vector 0.8.6"
    assert by_name(results)["ollama without token"].detail == "status 401, locked"


def test_database_down_fails():
    def down():
        raise OSError(f"could not connect with {PASSWORD}")

    result = by_name(run_checks(settings(), down, fake_get(), LANGFUSE_ENV))["database"]

    assert not result.ok and result.detail == "connection failed (OSError)"


def test_ollama_401_with_token_fails():
    def get(url, headers):
        return httpx.Response(401)

    results = by_name(run_checks(settings(), lambda: "0.8.6", get, {}))

    assert not results["ollama with token"].ok
    assert results["ollama with token"].detail == "status 401"


def test_ollama_answering_without_token_fails():
    results = by_name(run_checks(settings(), lambda: "0.8.6", fake_get(locked=False), {}))

    assert results["ollama with token"].ok
    assert not results["ollama without token"].ok
    assert "lock is off" in results["ollama without token"].detail


def test_langfuse_not_configured_is_skipped():
    get = fake_get()

    result = by_name(run_checks(settings(), lambda: "0.8.6", get, {}))["langfuse"]

    assert result.ok and result.detail == "skipped: not configured"
    assert all(url.startswith(OLLAMA) for url, _ in get.calls)


def test_report_never_contains_a_secret_value():
    def leaky_get(url, headers):
        raise httpx.ConnectError(f"failed {url} {headers}")

    def leaky_probe():
        raise OSError(f"bad password {PASSWORD}")

    reports = [
        render(run_checks(settings(), lambda: "0.8.6", fake_get(), LANGFUSE_ENV)),
        render(run_checks(settings(), leaky_probe, leaky_get, LANGFUSE_ENV)),
    ]

    for report in reports:
        for secret in (PASSWORD, TOKEN_ID, TOKEN_SECRET, LF_PUBLIC, LF_SECRET):
            assert secret not in report
