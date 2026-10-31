import json

import httpx
import pytest

from cairnly import llm as llm_module
from cairnly import ollama


@pytest.fixture
def ollama_server(monkeypatch):
    """Answer Ollama's HTTP API in-process: every client cairnly builds talks to `handler`."""
    seen: list[httpx.Request] = []
    real_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        lines = [{"message": {"content": "Hel"}}, {}, {"message": {"content": "lo"}},
                 {"done": True, "prompt_eval_count": 42, "eval_count": 7}]
        body = "\n".join(json.dumps(line) if line else "" for line in lines)
        return httpx.Response(200, text=body)

    monkeypatch.setattr(ollama.httpx, "Client",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    return seen


def test_ollama_stream_yields_message_content_and_usage(ollama_server, fresh_settings):
    model = llm_module.OllamaLLM(fresh_settings())

    assert "".join(model.stream("sys", "hi")) == "Hello"
    request = ollama_server[0]
    body = json.loads(request.content)
    assert request.url.path == "/api/chat"
    assert body["messages"][0] == {"role": "system", "content": "sys"}
    assert body["think"] is False
    assert model.usage == {"input": 42, "output": 7}
    assert model.timeout.read == 90  # the first-token limit covers a cold GPU


def test_modal_headers_are_sent_only_when_both_token_parts_are_set(
        ollama_server, monkeypatch, fresh_settings):
    monkeypatch.delenv("MODAL_PROXY_TOKEN_ID", raising=False)
    monkeypatch.delenv("MODAL_PROXY_TOKEN_SECRET", raising=False)
    list(llm_module.OllamaLLM(fresh_settings()).stream("sys", "hi"))
    assert "modal-key" not in ollama_server[-1].headers

    monkeypatch.setenv("MODAL_PROXY_TOKEN_ID", "wk-test")
    list(llm_module.OllamaLLM(fresh_settings()).stream("sys", "hi"))
    assert "modal-key" not in ollama_server[-1].headers  # half a token sends nothing

    monkeypatch.setenv("MODAL_PROXY_TOKEN_SECRET", "ws-test")
    list(llm_module.OllamaLLM(fresh_settings()).stream("sys", "hi"))
    assert ollama_server[-1].headers["modal-key"] == "wk-test"
    assert ollama_server[-1].headers["modal-secret"] == "ws-test"


def test_embeddings_use_the_same_authenticated_client(monkeypatch, fresh_settings):
    from cairnly import embed

    seen: list[httpx.Request] = []
    real_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"embeddings": [[0.1, 0.2]]})

    monkeypatch.setattr(ollama.httpx, "Client",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setenv("MODAL_PROXY_TOKEN_ID", "wk-test")
    monkeypatch.setenv("MODAL_PROXY_TOKEN_SECRET", "ws-test")
    fresh_settings()

    assert embed.embed_query("rag") == [0.1, 0.2]
    assert seen[0].url.path == "/api/embed"
    assert seen[0].headers["modal-key"] == "wk-test"


def test_get_llm_picks_ollama_and_rejects_unknown(fresh_settings):
    fresh_settings()
    assert llm_module.get_llm("ollama").name.startswith("ollama/")
    with pytest.raises(ValueError, match="unknown LLM_PROVIDER"):
        llm_module.get_llm("gpt")


def test_claude_is_disabled_by_default(monkeypatch, fresh_settings):
    monkeypatch.delenv("ALLOW_ANTHROPIC", raising=False)
    fresh_settings()

    assert llm_module.available_providers() == ["ollama"]
    with pytest.raises(llm_module.ProviderDisabled, match="turned off"):
        llm_module.get_llm("anthropic")


def test_cli_stops_with_exit_2_when_claude_is_off(monkeypatch, fresh_settings, capsys):
    from cairnly import cli

    monkeypatch.delenv("ALLOW_ANTHROPIC", raising=False)
    fresh_settings()
    with pytest.raises(SystemExit) as stop:
        cli.main(["ask", "What is RAG?", "--provider", "anthropic"])
    assert stop.value.code == 2
    assert llm_module.DISABLED_MESSAGE in capsys.readouterr().err


def test_claude_is_available_locally_when_allowed(monkeypatch, fresh_settings):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)  # never needed: no call is made
    monkeypatch.setenv("ALLOW_ANTHROPIC", "true")
    s = fresh_settings()

    assert llm_module.available_providers() == ["ollama", "anthropic"]
    assert llm_module.get_llm("anthropic").name == f"anthropic/{s.anthropic_model}"
