"""Run Ollama with cairnly's two models on a Modal GPU, for the public deploy.

Deploy from the repo root (steps and secrets: infra/README.md):

    uvx modal deploy deploy/modal_ollama.py

What it does:
- Builds an image from the official Ollama image with both models baked in (qwen3:8b for
  answers, nomic-embed-text for embeddings), so a container needs no downloads when it starts.
- Serves Ollama's own HTTP API on one T4 GPU that switches off after 5 idle minutes, so you
  pay only while someone is asking. max_containers=1 caps the cost; set a spend limit on the
  Modal Usage & Billing page as well.
- requires_proxy_auth=True: every request needs the Modal-Key and Modal-Secret headers of a
  proxy-auth token, which only the cairnly API holds (MODAL_PROXY_TOKEN_ID/_SECRET). Anyone
  else gets 401, so the URL is useless to strangers even if it leaks.

A cold start (container boot plus loading qwen3:8b into GPU memory) takes tens of seconds; the
API waits up to 90 s for the first token, and the chat shows a "waking up" notice meanwhile.
"""

import subprocess

import modal

OLLAMA_IMAGE = "ollama/ollama:0.11.2"  # same version the local Compose setup uses
MODELS = ("qwen3:8b", "nomic-embed-text")
PORT = 11434

# Ollama reads these at startup.
OLLAMA_ENV = {
    "OLLAMA_HOST": f"0.0.0.0:{PORT}",
    "OLLAMA_KEEP_ALIVE": "-1",  # keep the models loaded for the container's whole life
    "OLLAMA_NUM_PARALLEL": "4",  # matches the API's MAX_CONCURRENT_ANSWERS
}

# Build step: start a server, wait until it answers, pull both models into the image.
PULL_MODELS = (
    "ollama serve > /tmp/ollama-build.log 2>&1 & "
    "for _ in $(seq 1 60); do ollama list > /dev/null 2>&1 && break; sleep 1; done; "
    + " && ".join(f"ollama pull {model}" for model in MODELS)
)

image = (
    modal.Image.from_registry(OLLAMA_IMAGE, add_python="3.12")
    .entrypoint([])  # the image's ENTRYPOINT is the ollama binary; Modal needs its own
    .env(OLLAMA_ENV)
    .run_commands(f"bash -c '{PULL_MODELS}'")
)

app = modal.App("cairnly-ollama", image=image)


@app.function(gpu="T4", max_containers=1, scaledown_window=300, timeout=600)
@modal.concurrent(max_inputs=8)
@modal.web_server(port=PORT, startup_timeout=180, requires_proxy_auth=True)
def ollama():
    """Start Ollama; Modal forwards the function's URL to PORT once it answers."""
    subprocess.Popen(["ollama", "serve"])
