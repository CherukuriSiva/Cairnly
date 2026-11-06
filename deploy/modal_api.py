"""Run the cairnly API, its database jobs and a key check on Modal, for the public deploy.

Deploy and run from the repo root, after deploy/modal_ollama.py is deployed (steps:
infra/README.md):

    uvx modal deploy deploy/modal_api.py       # serves <workspace>--cairnly-api-web.modal.run
    uvx modal run deploy/modal_api.py::check   # every key and service, no secret printed
    uvx modal run deploy/modal_api.py::ingest  # migrate, then ingest every KB in kbs.yaml
    uvx modal run deploy/modal_api.py::migrate # only create or upgrade the tables

What it does:
- Builds the image the way the Dockerfile does: Python 3.12, the locked dependencies with the
  rerank extra, the repo files in the repo layout under /app (cairnly finds kbs.yaml, prompts
  and content two levels above its own code), the project installed editable, and the reranker
  model baked in, so a container downloads nothing when it starts.
- Serves the FastAPI app from ONE container (max_containers=1). The rate limits and answer
  slots live in the process's memory, so a second container would double every limit. The
  container switches off after 5 idle minutes, so the API costs nothing while nobody asks.
- Takes every secret from the Modal secret `cairnly-api` and nothing else from the workspace.
  Its keys: DATABASE_URL (the Neon unpooled connection string), MODAL_PROXY_TOKEN_ID,
  MODAL_PROXY_TOKEN_SECRET, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST.
- Finds the Ollama URL at container start from the deployed `cairnly-ollama` app, so no
  workspace URL is written here.

Claude never runs here: CAIRNLY_ENV=production makes the API refuse to start if ALLOW_ANTHROPIC
is ever set, and no Anthropic key is in the secret.
"""

import os
from pathlib import Path

import modal

REPO = Path(__file__).resolve().parents[1]
ROOT = "/app"  # the repo root inside the image
HF_HOME = f"{ROOT}/.cache/huggingface"
RERANK_MODEL = ("from cairnly.rerank import MODEL; "
                "from sentence_transformers import CrossEncoder; CrossEncoder(MODEL)")

# Settings that are not secret. Each one is read when cairnly.config loads.
API_ENV = {
    "CAIRNLY_ENV": "production",  # refuses ALLOW_ANTHROPIC, so Claude can never be switched on
    "LLM_PROVIDER": "ollama",  # the Modal GPU app
    "TRUST_PROXY": "0",  # Modal hands the API the real caller's address; never trust the header
    "CORS_ORIGINS": "https://cairnly-blond.vercel.app",  # the Vercel production site
    "LANGFUSE_TRACING_ENVIRONMENT": "production",  # tells production traces apart in Langfuse
}

SECRETS = [modal.Secret.from_name("cairnly-api")]

image = (
    modal.Image.debian_slim(python_version="3.12")
    # The locked dependencies (without cairnly itself and without the dev group), with the
    # Dockerfile's uv version.
    .uv_sync(str(REPO), extras=["rerank"], extra_options="--no-dev", uv_version="0.12.23")
    .add_local_file(REPO / "pyproject.toml", f"{ROOT}/pyproject.toml", copy=True)
    .add_local_file(REPO / "uv.lock", f"{ROOT}/uv.lock", copy=True)
    .add_local_file(REPO / "README.md", f"{ROOT}/README.md", copy=True)
    .add_local_file(REPO / "kbs.yaml", f"{ROOT}/kbs.yaml", copy=True)
    .add_local_dir(REPO / "src", f"{ROOT}/src", copy=True, ignore=["**/__pycache__"])
    .add_local_dir(REPO / "prompts", f"{ROOT}/prompts", copy=True)
    .add_local_dir(REPO / "content", f"{ROOT}/content", copy=True)
    .run_commands(f"/.uv/uv pip install --python /.uv/.venv/bin/python --no-deps -e {ROOT}")
    .env({"HF_HOME": HF_HOME, "PYTHONUNBUFFERED": "1"})
    .run_commands(f'python -c "{RERANK_MODEL}"')
    .env({"HF_HUB_OFFLINE": "1"})  # the model is in the image; never fetch at runtime
    .workdir(ROOT)
)

app = modal.App("cairnly-api", image=image)


def use_production_settings() -> None:
    """Point cairnly at the deployed Ollama app. Runs in the container before cairnly.config
    is imported, because the settings are read once, at import."""
    os.chdir(ROOT)  # kbs.yaml paths such as `content` are relative to the repo root
    ollama = modal.Function.from_name("cairnly-ollama", "ollama")
    os.environ["OLLAMA_URL"] = ollama.get_web_url()


@app.function(secrets=SECRETS, env=API_ENV, max_containers=1, scaledown_window=300,
              timeout=600, cpu=2, memory=4096)
@modal.concurrent(max_inputs=16)  # answers stay capped at MAX_CONCURRENT_ANSWERS (4)
@modal.asgi_app()
def web():
    """The public API. No proxy auth: the browser calls it directly."""
    use_production_settings()
    from cairnly.api import app as api

    return api


@app.function(secrets=SECRETS, env=API_ENV, timeout=1800)
def ingest():
    """Create the schema, then chunk, embed and store every knowledge base in kbs.yaml."""
    use_production_settings()
    from cairnly.cli import main
    from cairnly.kb import load_kbs

    main(["migrate"])
    for name in load_kbs():
        main(["ingest", "--kb", name])


@app.function(secrets=SECRETS, env=API_ENV, timeout=300)
def migrate():
    """Create or upgrade the tables only (safe to re-run), e.g. the saved-conversation tables
    after an API update, without re-ingesting anything."""
    use_production_settings()
    from cairnly.cli import main

    main(["migrate"])


@app.function(secrets=SECRETS, env=API_ENV, timeout=600)
def check():
    """Check the database, Ollama (with and without the token) and Langfuse; prints names and
    pass or fail only. Fails the run when any check fails."""
    use_production_settings()
    from cairnly.keycheck import main

    if not main():
        raise RuntimeError("some checks failed; see the report above")
