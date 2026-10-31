# API image. Two stages: install dependencies with uv, then copy only the virtualenv and code
# into a slim runtime image (no build tools, no uv) that runs as a non-root user. The content
# folder is included so a one-off job can run `cairnly migrate && cairnly ingest --kb lessons`,
# and because the API reads content/syllabus.yaml and content/sections.json.
# The reranker (CPU PyTorch) and its model are baked in, so production runs the same retrieval
# pipeline that CI evaluates, with no model download at startup.
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.12.23 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never \
    HF_HOME=/app/.cache/huggingface
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --extra rerank --no-install-project
COPY src ./src
COPY kbs.yaml ./
COPY prompts ./prompts
COPY content ./content
RUN uv sync --frozen --no-dev --extra rerank
RUN .venv/bin/python -c "from cairnly.rerank import MODEL; from sentence_transformers import CrossEncoder; CrossEncoder(MODEL)"

FROM python:3.12-slim
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=build --chown=10001 /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 \
    HF_HOME=/app/.cache/huggingface HF_HUB_OFFLINE=1
USER 10001
EXPOSE 8010
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8010/livez')"
CMD ["cairnly", "serve", "--host", "0.0.0.0", "--port", "8010"]
