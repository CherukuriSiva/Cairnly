# cairnly

A deployable AI knowledge assistant. Point it at a folder of docs and ask questions; answers
stream back with citations to the exact sections they came from, and questions the docs
don't cover get an honest "not found" instead of a guess.

Built in public, one milestone at a time. **M1 (this version): the core RAG loop.**

## How it works

```
lessons (.mdx) --curate--> corpus/*.md --ingest--> Postgres (full-text + pgvector)
                                                        |
question --> hybrid search (keyword + vector, RRF) --> confidence gate --> LLM --> streamed answer + [n] citations
```

| Piece | What it does | Code |
|---|---|---|
| Curation | MDX lessons to plain markdown, with a kept/dropped report ([CURATION.md](CURATION.md)) | `curate.py` |
| Ingestion | One chunk per heading section; local embeddings; only changed files re-embedded | `chunk.py`, `embed.py`, `ingest.py` |
| Retrieval | Postgres full-text + pgvector cosine, merged with Reciprocal Rank Fusion | `search.py` |
| Generation | Confidence gate, numbered sources, required `[n]` citations, streamed tokens | `answer.py` |
| Providers | Local Ollama (default, free) or the Claude API, behind one interface | `llm.py` |
| API | FastAPI: `/health`, `/search`, streaming `/ask` (Server-Sent Events) | `api.py` |
| UI | Next.js chat with clickable citations and a provider switch | `web/` |

How and why each piece works, in plain English: [docs/LEARN-M1.md](docs/LEARN-M1.md).
Design decisions: [docs/adr/](docs/adr/).

## Quick start

Needs [uv](https://docs.astral.sh/uv/), Docker, Node 20+, and [Ollama](https://ollama.com):

```bash
ollama pull nomic-embed-text && ollama pull qwen3:8b

cp .env.example .env               # defaults work for the local setup
docker compose up -d db            # Postgres + pgvector on port 5434
uv sync
uv run cairnly migrate             # create tables
uv run cairnly ingest corpus       # chunk + embed + store
uv run cairnly ask "What is RAG and when does it beat pure prompting?"

uv run cairnly serve               # API on http://localhost:8010
cd web && npm install && npm run dev   # UI on http://localhost:3010
```

`http://localhost:3010/?q=your+question` opens the UI with a question already asked.

To use Claude instead of the local model: set `LLM_PROVIDER=anthropic` and
`ANTHROPIC_API_KEY` in `.env`, or pick "Claude API" in the UI.

Run the whole stack (database, API, UI) in Docker instead: `docker compose --profile full up -d --build`.
Ollama stays on the host; the API container reaches it at `host.docker.internal:11434`.

## Tests

```bash
uv run pytest -m "not db"          # fast unit tests, no services needed
uv run pytest                      # everything (needs `docker compose up -d db`)
```

Tests use fake embedders and LLMs, so they need neither Ollama nor an API key. CI runs lint,
tests against a real pgvector container, the API image build and the web build.

## Roadmap

| Milestone | Adds |
|---|---|
| **M1** | Core RAG: curation, hybrid search, cited streaming answers, API, UI, Docker, CI |
| M2 | Golden-set evals (Recall@k, MRR, faithfulness) as a CI gate; Langfuse tracing; prompt versions |
| M3 | Guardrails, prompt-injection and PII defences, red-team suite; cache; cost; rate limits |
| M4 | Study-planner agent with tools; MCP server for Claude and Cursor |
| M5 | MLOps: pipelines, MLflow, LoRA fine-tune experiment, drift monitoring |
| M6 | Platform: auth, multi-tenancy, RBAC, audit log, more connectors; Helm + Terraform (AWS) |
| M7 | Reliability: Prometheus + Grafana, SLOs and alerts, load tests, runbooks |

## Content

The demo corpus is the author's own GradStack lessons. Only free lessons and roadmaps are
committed; see [CURATION.md](CURATION.md) and [ADR 0004](docs/adr/0004-public-corpus-policy.md).
