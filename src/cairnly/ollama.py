"""One HTTP client for every call to Ollama (embeddings and chat).

In production Ollama runs on a Modal GPU behind Modal's proxy auth: a request without the
Modal-Key and Modal-Secret headers gets 401. Building the client in one place means both call
sites send the token, and neither can forget it. Locally the token is unset, so no auth
headers are sent and a plain local Ollama works as before.
"""

import httpx

from cairnly.config import Settings


def auth_headers(s: Settings) -> dict[str, str]:
    """The Modal proxy-auth headers, only when both halves of the token are set."""
    if s.modal_proxy_token_id and s.modal_proxy_token_secret:
        return {"Modal-Key": s.modal_proxy_token_id, "Modal-Secret": s.modal_proxy_token_secret}
    return {}


def ollama_client(s: Settings, timeout: float | httpx.Timeout) -> httpx.Client:
    """An httpx client for Ollama's API at OLLAMA_URL, with the auth headers when set."""
    return httpx.Client(base_url=s.ollama_url, timeout=timeout, headers=auth_headers(s))
