# cairnly

A free, public site for learning AI engineering, made for new graduates, with a chat that
answers from the lessons. 126 lessons in six tracks, 7 roadmaps and 29 insights, all
generated from one folder of MDX. Chat answers stream back with citations that open the exact
lesson section they came from, and questions the lessons don't cover get an honest "not
found" instead of a guess.

Built in public, one milestone at a time. **Now: M4 (production ready).**

## Results (measured, not guessed)

| | Recall@5 | MRR | Off-topic questions answered | Faithfulness |
|---|---|---|---|---|
| Lessons, all content (127 questions, M3) | **0.937** | **0.873** | **0%** (0 of 40) | 97.5% (M2) |
| Follow-ups (15, qwen3:8b rewrite) | rewritten = standalone (0.867 to 0.933 across runs) | | | |

M2 added a cross-encoder reranker and a confidence gate calibrated from evals (Recall@5
0.88 → 0.94). M3 measured the gate again on all public content with 40 off-topic questions
and raised it to 0.70 ([ADR 0011](docs/adr/0011-recalibrated-confidence-gate.md)). The
faithfulness number is from M2 and was not re-run in M3. How it was all measured:
[LEARN-M2](docs/LEARN-M2.md), [LEARN-M3](docs/LEARN-M3.md).

## How it works

```
content/*.mdx --+--> web build --> static lesson pages (heading ids)
                |
                +--> mdx.py --> chunks with page anchors --ingest--> Postgres (full-text + pgvector)
                                                                       |
question (+ earlier turns) --> rewrite follow-up --> hybrid search (keyword + vector, RRF)
  --> cross-encoder rerank --> confidence gate --> LLM --> streamed answer + [n] citations
                                                           (each citation links /<track>/<lesson>#<section>)
```

| Piece | What it does | Code |
|---|---|---|
| Content | All lessons, insights and roadmaps as MDX; `syllabus.yaml` sets the order ([content/README.md](content/README.md)) | `content/`, `mdx.py`, `syllabus.py` |
| Pages | Static Next.js pages: syllabus, tracks, lessons with sidebar and prev/next, roadmaps, insights; plus a News page that reads open feeds and refreshes every hour | `web/app/`, `web/components/`, `web/lib/news/` |
| Anchors | One heading-id rule shared by Python and the web, so citations open the right section | `pages.py`, `web/lib/anchors.ts` |
| Ingestion | One chunk per heading section with its page anchor; local embeddings; only changed files re-embedded | `chunk.py`, `embed.py`, `ingest.py` |
| Knowledge bases | Each with its own gate, prompt version and notice ([kbs.yaml](kbs.yaml)) | `kb.py` |
| Retrieval | Postgres full-text + pgvector cosine, merged with Reciprocal Rank Fusion; optional track scope | `search.py` |
| Reranking | Cross-encoder re-orders the top 30 candidates (chosen by measurement) | `rerank.py` |
| Follow-ups | A follow-up is rewritten into a standalone question before search | `rewrite.py` |
| Generation | Confidence gate, numbered sources, required `[n]` citations, learner-friendly prompt | `answer.py` |
| Guard | Rules for injection, jailbreaks, prompt extraction and junk; an output check that withdraws prompt leaks and flags uncited answers ([SAFETY.md](SAFETY.md)) | `guard.py` |
| Limits | Per-IP and site-wide rate limits, 4 answers at once, first-token and answer time limits | `limits.py` |
| Providers | Ollama (local, or on a Modal GPU in production); the Claude API for local development only | `llm.py`, `ollama.py` |
| API | FastAPI: `/health`, `/config`, `/search`, streaming `/ask` (Server-Sent Events) with history and track | `api.py` |
| Chat | Next.js chat with clickable citations, lesson links, follow-ups, a track scope and a cold-start notice | `web/components/Chat.tsx` |
| Evals | Quiz golden set, off-topic set, Recall@k, MRR, gate errors, follow-up eval, red-team gate, CI gates | `evals.py` |
| Tracing | One Langfuse trace per question (guard, rewrite, retrieve, generate, output check), with no user text by default ([PRIVACY.md](PRIVACY.md)) | `tracing.py` |
| Deploy | Docker Compose, Helm (tested on kind), Terraform for AWS + GitHub OIDC deploy, Ollama on a Modal GPU | [infra/](infra/README.md), `deploy/` |

How and why each piece works, in plain English: [LEARN-M1](docs/LEARN-M1.md),
[LEARN-M2](docs/LEARN-M2.md), [LEARN-M3](docs/LEARN-M3.md), [LEARN-M4](docs/LEARN-M4.md).
Design decisions: [docs/adr/](docs/adr/). Safety and privacy: [SAFETY.md](SAFETY.md),
[PRIVACY.md](PRIVACY.md).

## Quick start

Needs [uv](https://docs.astral.sh/uv/), Docker, Node 20+, and [Ollama](https://ollama.com):

```bash
ollama pull nomic-embed-text && ollama pull qwen3:8b

cp .env.example .env               # defaults work for the local setup
docker compose up -d db            # Postgres + pgvector on port 5434
uv sync --extra rerank             # without --extra rerank, search skips reranking
uv run cairnly migrate             # create tables (safe to re-run; upgrades old databases)
uv run cairnly ingest --kb lessons # chunk + embed + store everything in content/
uv run cairnly ask "What is RAG and when does it beat pure prompting?"

uv run cairnly serve               # API on http://localhost:8010
cd web && npm install && npm run dev   # site and chat on http://localhost:3010
```

`http://localhost:3010/?q=your+question&track=ai-engineering` opens the chat with a question
already asked and the search limited to one track. Every lesson page has an "Ask cairnly
about this lesson" button that does this for you.

The Claude API is for local development only. To try it, set `ALLOW_ANTHROPIC=true` in `.env`
and keep your Anthropic key in your own shell environment (never in `.env`, the repo or a
deploy). The chat then shows a "Claude API (local only)" choice. A server started with
`CAIRNLY_ENV=production` refuses `ALLOW_ANTHROPIC`, and without it `/ask` answers 403 for
`provider=anthropic` ([ADR 0013](docs/adr/0013-models-on-a-modal-gpu.md)).

Run the whole stack (database, API, site) in Docker instead: `docker compose --profile full up -d --build`.
Ollama stays on the host; the API container reaches it at `host.docker.internal:11434`.

## Tracing

Every question can be traced in [Langfuse](https://langfuse.com): the guard, the follow-up
rewrite, what was retrieved, the best similarity, prompt version, model, time to first token,
token usage, scores and errors. Follow-ups from one browser tab share a session. Traces hold no
question or answer text unless `TRACE_CONTENT=1` (local debugging only;
[ADR 0015](docs/adr/0015-privacy-safe-tracing.md)).

```bash
docker compose -f compose.observability.yaml up -d     # Langfuse on http://localhost:3011
# in .env: LANGFUSE_PUBLIC_KEY=pk-lf-cairnly-local  LANGFUSE_SECRET_KEY=sk-lf-cairnly-local
```

Login `admin@cairnly.local` / `cairnly-local-admin` (local dev defaults only).

## Evals

```bash
uv run cairnly eval --kb lessons --gate evals/gates.yaml   # Recall@5, MRR, gate errors
uv run cairnly eval --kb lessons --judge --limit 40         # + LLM-as-judge faithfulness
uv run cairnly eval-followups                               # follow-up rewriting (needs a chat model)
uv run cairnly eval-redteam --gate evals/gates.yaml         # input guard: wrong blocks, missed attacks
```

CI runs the lessons eval on all content with real embeddings and the red-team gate, and fails
the build when a metric breaks `evals/gates.yaml`.

## Tests

```bash
uv run pytest -m "not db"          # fast unit tests, no services needed
uv run pytest                      # everything (needs `docker compose up -d db`)
cd web && npm test                 # syllabus, links, anchors, quiz and chat client
```

Tests use fake embedders and LLMs, so they need neither Ollama nor an API key. CI runs lint,
tests against a real pgvector container, the eval gate with real embeddings, Terraform and
Helm validation, both image builds, and the web tests and build.

## Deploy

See [infra/README.md](infra/README.md): Docker Compose, Kubernetes (`scripts/kind-up.sh`), and
AWS (ECS Fargate + RDS + ALB) deployed by a GitHub Actions workflow with no stored AWS keys.
In production the models run on a Modal T4 GPU that switches off when idle
([deploy/modal_ollama.py](deploy/modal_ollama.py)).
The web image is built from the repository root (`docker build -f web/Dockerfile .`) because
its pages are generated from `content/`.

## Roadmap

| Milestone | Adds |
|---|---|
| **M1** ✅ | Core RAG: hybrid search, cited streaming answers, API, UI, Docker, CI |
| **M2** ✅ | Evals + CI gate, calibrated gate, reranker, Langfuse tracing, prompt versions, Helm, Terraform |
| **M3** ✅ | Learning site: all content public as MDX, syllabus, lesson pages, citations that open lessons, follow-ups, book notes |
| **M4** ✅ | Production hardening: models on a Modal GPU, rate and concurrency limits, input guard and output check, red-team CI gate, privacy-safe Langfuse tracing, Claude local only |
| M5 | Study-planner agent with tools; MCP server for Claude and Cursor |
| M6 | MLOps: pipelines, MLflow, LoRA fine-tune experiment, drift monitoring |
| M7 | Platform: auth, multi-tenancy, RBAC, audit log, more connectors, PII redaction, response cache |
| M8 | Reliability: Prometheus + Grafana, SLOs and alerts, load tests, runbooks |

## Content

All content is public. The lessons, insights and roadmaps were imported from the author's own
GradStack lessons; see [content/README.md](content/README.md) and
[ADR 0009](docs/adr/0009-public-mdx-content.md). Some lessons include short notes on Chip
Huyen's book "AI Engineering" (O'Reilly, 2025), written in our own words with a pointer to the
chapter.

## License

The code is under the [MIT License](LICENSE). The content in `content/` (lessons, book notes,
roadmaps and insights) and the docs are under
[CC BY-NC-SA 4.0](content/LICENSE.md). Insights summarize other people's public posts and
talks; the ideas belong to their authors, and each insight links its source.
