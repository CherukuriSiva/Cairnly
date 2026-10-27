import json
from contextlib import contextmanager

import pytest

from cairnly import llm as llm_module
from cairnly.config import get_settings


def test_ollama_stream_yields_message_content(monkeypatch):
    sent = {}

    class FakeResponse:
        def raise_for_status(self):
            pass

        def iter_lines(self):
            yield json.dumps({"message": {"content": "Hel"}})
            yield ""
            yield json.dumps({"message": {"content": "lo"}})
            yield json.dumps({"done": True})

    @contextmanager
    def fake_stream(method, url, json, timeout):
        sent.update(method=method, url=url, body=json)
        yield FakeResponse()

    monkeypatch.setattr(llm_module.httpx, "stream", fake_stream)
    model = llm_module.OllamaLLM(get_settings())

    assert "".join(model.stream("sys", "hi")) == "Hello"
    assert sent["url"].endswith("/api/chat")
    assert sent["body"]["messages"][0] == {"role": "system", "content": "sys"}
    assert sent["body"]["think"] is False


def test_get_llm_picks_provider_and_rejects_unknown():
    assert llm_module.get_llm("ollama").name.startswith("ollama/")
    assert llm_module.get_llm("anthropic").name == f"anthropic/{get_settings().anthropic_model}"
    with pytest.raises(ValueError, match="unknown LLM_PROVIDER"):
        llm_module.get_llm("gpt")
