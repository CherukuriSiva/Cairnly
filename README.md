# cairnly

A deployable AI knowledge assistant. Point it at a folder of docs and ask questions; answers
stream back with citations to the exact sections they came from, and questions the docs
don't cover get an honest "not found" instead of a guess.

Built in public, one milestone at a time. **Now: M1 (core RAG) + M2 (evals, reranking,
tracing, deployment).**

## Results (measured, not guessed)

| | Recall@5 | MRR | Off-topic questions answered | Faithfulness |
|---|---|---|---|---|
| Lessons (127 questions) | 0.88 → **0.94** | 0.75 → **0.87** | 94% → **0%** | 97.5% |

Before → after M2: a cross-encoder reranker and a confidence gate calibrated from evals. How
these were measured, and what they mean: [docs/LEARN-M2.md](docs/LEARN-M2.md).

## How it works

```
docs (md / jsonl) --connectors--> chunks --ingest--> Postgres (full-text + pgvector), one knowledge base each
                                                        |
question --> hybrid search (keyword + vector, RRF) --> cross-encoder rerank --> confidence gate --> LLM --> streamed answer + [n] citations
                                                                                                   (traced in Langfuse)
```

| Piece | What it does | Code |
|---|---|---|
| Curation | MDX lessons to plain markdown, with a kept/dropped report ([CURATION.md](CURATION.md)) | `curate.py` |
| Ingestion | One chunk per heading section; local embeddings; only changed files re-embedded | `chunk.py`, `embed.py`, `ingest.py` |
| Knowledge bases | Separate corpora, each with its own gate, prompt version and notice ([kbs.yaml](kbs.yaml)) | `kb.py` |
| Retrieval | Postgres full-text + pgvector cosine, merged with Reciprocal Rank Fusion | `search.py` |
| Reranking | Cross-encoder re-orders the top 30 candidates (chosen by measurement) | `rerank.py` |
| Generation | Confidence gate, numbered sources, required `[n]` citations, streamed tokens | `answer.py` |
| Providers | Local Ollama (default, free) or the Claude API, behind one interface | `llm.py` |
| API | FastAPI: `/health`, `/search`, streaming `/ask` (Server-Sent Events) | `api.py` |
| UI | Next.js chat with clickable citations, knowledge-base and provider switches | `web/` |
| Evals | Golden sets, Recall@k, MRR, gate errors, LLM-as-judge faithfulness, CI gate | `evals.py` |
| Tracing | One Langfuse trace per question (retrieve, generate, time to first token) | `tracing.py` |
| Deploy | Docker Compose, Helm (tested on kind), Terraform for AWS + GitHub OIDC deploy | [infra/](infra/README.md) |

How and why each piece works, in plain English: [LEARN-M1](docs/LEARN-M1.md), [LEARN-M2](docs/LEARN-M2.md).
Design decisions: [docs/adr/](docs/adr/).

## Quick start

Needs [uv](https://docs.astral.sh/uv/), Docker, Node 20+, and [Ollama](https://ollama.com):

```bash
ollama pull nomic-embed-text && ollama pull qwen3:8b

cp .env.example .env               # defaults work for the local setup
docker compose up -d db            # Postgres + pgvector on port 5434
uv sync --extra rerank             # without --extra rerank, search skips reranking
uv run cairnly migrate             # create tables
uv run cairnly ingest --kb lessons # chunk + embed + store (kbs.yaml says where)
uv run cairnly ask "What is RAG and when does it beat pure prompting?"

uv run cairnly serve               # API on http://localhost:8010
cd web && npm install && npm run dev   # UI on http://localhost:3010
```

`http://localhost:3010/?q=your+question` opens the UI with a question already asked.

To use Claude instead of the local model: set `LLM_PROVIDER=anthropic` and
`ANTHROPIC_API_KEY` in `.env`, or pick "Claude API" in the UI.

Run the whole stack (database, API, UI) in Docker instead: `docker compose --profile full up -d --build`.
Ollama stays on the host; the API container reaches it at `host.docker.internal:11434`.

## Tracing

Every question can be traced in [Langfuse](https://langfuse.com): what was retrieved, the
best similarity, prompt version, model, time to first token and the answer.

```bash
docker compose -f compose.observability.yaml up -d     # Langfuse on http://localhost:3011
# in .env: LANGFUSE_PUBLIC_KEY=pk-lf-cairnly-local  LANGFUSE_SECRET_KEY=sk-lf-cairnly-local
```

Login `admin@cairnly.local` / `cairnly-local-admin` (local dev defaults only).

## Evals

```bash
uv run cairnly eval --kb lessons --gate evals/gates.yaml   # Recall@5, MRR, gate errors
uv run cairnly eval --kb lessons --judge --limit 40         # + LLM-as-judge faithfulness
```

CI runs the lessons eval with real embeddings and fails the build below `evals/gates.yaml`.

## Tests

```bash
uv run pytest -m "not db"          # fast unit tests, no services needed
uv run pytest                      # everything (needs `docker compose up -d db`)
```

Tests use fake embedders and LLMs, so they need neither Ollama nor an API key. CI runs lint,
tests against a real pgvector container, the eval gate with real embeddings, Terraform and
Helm validation, both image builds and the web build.

## Deploy

See [infra/README.md](infra/README.md): Docker Compose, Kubernetes (`scripts/kind-up.sh`), and
AWS (ECS Fargate + RDS + ALB) deployed by a GitHub Actions workflow with no stored AWS keys.

## Roadmap

| Milestone | Adds |
|---|---|
| **M1** ✅ | Core RAG: curation, hybrid search, cited streaming answers, API, UI, Docker, CI |
| **M2** ✅ | Evals + CI gate, calibrated gate, reranker, Langfuse tracing, prompt versions, Helm, Terraform |
| M3 | Guardrails, prompt-injection and PII defences, red-team suite; cache; cost; rate limits |
| M4 | Study-planner agent with tools; MCP server for Claude and Cursor |
| M5 | MLOps: pipelines, MLflow, LoRA fine-tune experiment, drift monitoring |
| M6 | Platform: auth, multi-tenancy, RBAC, audit log, more connectors |
| M7 | Reliability: Prometheus + Grafana, SLOs and alerts, load tests, runbooks |

## Content

The demo corpus is the author's own GradStack lessons. Only free lessons and roadmaps are
committed; see [CURATION.md](CURATION.md) and [ADR 0004](docs/adr/0004-public-corpus-policy.md).
