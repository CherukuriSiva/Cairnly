# Cairnly

**Learn AI engineering. Explore how it's built.**

[![CI](https://github.com/CherukuriSiva/Cairnly/actions/workflows/ci.yml/badge.svg)](https://github.com/CherukuriSiva/Cairnly/actions/workflows/ci.yml)
[![Code: MIT](https://img.shields.io/badge/code-MIT-blue)](LICENSE)
[![Content: CC BY-NC-SA 4.0](https://img.shields.io/badge/content-CC%20BY--NC--SA%204.0-lightgrey)](content/LICENSE.md)

A free AI engineering course with a tutor that cites its sources, and the open-source RAG
app that runs it: local models, evals, safety checks, tracing and deployment, all in this repo.

**[Try the tutor](https://cairnly-blond.vercel.app/ask)** ·
**[Recorded demo](https://cairnly-blond.vercel.app/ask?demo=1)** (works even when the GPU is asleep) ·
**[Explore the architecture](#how-it-works)** ·
**[Run it yourself](#installation)**

![Asking Cairnly a question: the answer types out with numbered citations and source cards](docs/images/ask-demo.gif)

| Learn with Cairnly | Build with Cairnly |
|---|---|
| 126 free lessons in six tracks, 7 roadmaps and 29 insights | Hybrid search (keyword + vector) with a cross-encoder reranker |
| A tutor whose answers cite the exact lesson section | An eval suite: 627 questions, Recall@5 0.971, gated in CI |
| An honest "not in the lessons" instead of a guess | A confidence gate tuned on measured trade-offs |
| Quizzes, progress tracking and a ⌘K search | An input guard and output check, with their misses published |
| A voice mode with live captions (self-hosted, see below) | Langfuse tracing, Modal GPUs, Neon, Vercel, Helm and Terraform |

<table>
  <tr>
    <td><img src="docs/images/home-dark.png" alt="The Cairnly home page in dark mode" /></td>
    <td><img src="docs/images/lesson-light.png" alt="A lesson page in light mode with its sidebar and table of contents" /></td>
  </tr>
</table>

**Licenses:** the code is MIT. The lessons and docs are CC BY-NC-SA 4.0: share and adapt them
with credit, under the same license, but not commercially ([details](#license)).

Built in public, one milestone at a time: M1 to M4 are done; next is M5, a study-planner agent
([roadmap](#roadmap)). Ideas, bugs and pull requests are welcome: see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Results (measured, not guessed)

| | Recall@5 | MRR | Off-topic questions answered | Faithfulness |
|---|---|---|---|---|
| Lessons, all content (627 questions: 127 quiz + 500 written) | **0.971** | **0.914** | **2.7%** (4 of 150) | 97.5% (M2) |
| Follow-ups (15, qwen3:8b rewrite) | rewritten = standalone (0.867 to 0.933 across runs) | | | |

The confidence gate (0.66) refuses 5.1% of those 627 questions, all of them written ones (32
of 500), and answers 4 of the 150 off-topic questions (piano practice, sourdough, portrait
drawing, declining an invitation). Short questions score close to off-topic ones, so no cutoff
separates them cleanly: 0.70 answered no off-topic question but refused 96 real ones, and
0.64 would answer 12 off-topic questions ([ADR 0016](docs/adr/0016-written-eval-set.md)).

The input guard (M4) blocks 0 of 955 real learner questions and misses 9 of 155 attacks in its
tuning set. On 11 fresh attacks it was never tuned on, it misses 8, so it is a first filter,
not a wall: the output check behind it withdraws any answer that leaks the system prompt
([SAFETY.md](SAFETY.md)).

**Voice** ([ADR 0019](docs/adr/0019-voice-stack.md), synthetic speech, an Apple M5 Max CPU):
Whisper large-v3-turbo hears 40 spoken questions in ten accents with a 1.5% word error rate
(Parakeet-TDT 2.7%, but 50 times faster); Kokoro starts speaking a sentence in 0.5 s. Locally,
the first words of an answer play about 4.6 s after the caller stops talking, with a holding
line ("Let me check the lessons.") after 2.6 s; speech to text runs on the CPU here and on a GPU
in production.

M2 added a cross-encoder reranker and a confidence gate calibrated from evals (Recall@5
0.88 → 0.94). M3 measured the gate again on all public content with 40 off-topic questions
and raised it to 0.70 ([ADR 0011](docs/adr/0011-recalibrated-confidence-gate.md)). Cycle 4
added 500 written learner questions (3 to 5 per lesson) and 110 more off-topic questions, and
re-measured: the gate moved down to 0.66 ([ADR 0016](docs/adr/0016-written-eval-set.md)). The
faithfulness number is from M2 and was not re-run since. How it was all measured:
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

spoken question --> voice server: Silero VAD --> Whisper --> /ask (all of the above, saved as voice)
  --> speakable sentences --> Kokoro --> spoken answer + live captions
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
| API | FastAPI: `/health`, `/config` (providers and optional features), `/search`, streaming `/ask` (Server-Sent Events) with history or a saved conversation, and track; `/conversations` to create, read and delete a saved chat and vote on its answers | `api.py` |
| Saved conversations | Questions, answers (with sources) and votes in Postgres, keyed by a random id only the browser keeps; the server holds the follow-up history; idle chats deleted after 30 days ([ADR 0018](docs/adr/0018-saved-conversations-and-chat-engine.md), [PRIVACY.md](PRIVACY.md)) | `conversations.py` |
| Chat engine | Framework-free: SSE event parser, a reducer from events to rows, a recovery table (one automatic retry per failure kind), a live transport with a stall timer and a replay transport with recorded streams | `web/lib/chat/` |
| Chat | Next.js chat at `/ask`: answers typed out smoothly, clickable citations, source cards, a link to the full lesson, thumbs up and down, follow-ups, a track scope, auto-scroll that stops when you scroll up, a reload that keeps the chat, friendly cold-start cards, and a recorded demo at `/ask?demo=1`. Works against older APIs too (it reads `/config`) | `web/components/chat/` |
| Voice | A Pipecat pipeline per call: Silero VAD, Whisper large-v3-turbo, a brain that asks `/ask` (so the guard, limits, gate, citations and saving are the text chat's), Kokoro. Holding line, sentence-by-sentence speech, barge-in (or half duplex), captions, call budgets; WebSocket audio in production, WebRTC locally ([ADR 0019](docs/adr/0019-voice-stack.md)) | `voice/`, `web/lib/voice/` |
| Evals | Golden set of quiz plus written questions (reported per source), off-topic set, Recall@k, MRR, gate errors, follow-up eval, red-team gate, CI gates | `evals.py` |
| Tracing | One Langfuse trace per question (guard, rewrite, retrieve, generate, output check), with no user text by default ([PRIVACY.md](PRIVACY.md)) | `tracing.py` |
| Deploy | Vercel + Modal (API and Ollama GPU) + Neon on free plans, Docker Compose, Helm (tested on kind), Terraform for AWS + GitHub OIDC deploy | [infra/](infra/README.md), `deploy/` |

How and why each piece works, in plain English: [LEARN-M1](docs/LEARN-M1.md),
[LEARN-M2](docs/LEARN-M2.md), [LEARN-M3](docs/LEARN-M3.md), [LEARN-M4](docs/LEARN-M4.md),
[LEARN-CHAT](docs/LEARN-CHAT.md) (saved conversations, the chat engine and voice mode).
Design decisions: [docs/adr/](docs/adr/). Safety and privacy: [SAFETY.md](SAFETY.md),
[PRIVACY.md](PRIVACY.md).

## Installation

### What you need

| Tool | Version | Used for |
|---|---|---|
| [uv](https://docs.astral.sh/uv/) | any recent | Python 3.12 and the API's dependencies (uv installs Python for you) |
| [Docker](https://docs.docker.com/get-docker/) | with Compose v2 | Postgres + pgvector, and optionally Langfuse |
| [Node.js](https://nodejs.org) | 20 or newer | the site and the chat |
| [Ollama](https://ollama.com) | any recent | local embeddings and answers |

About 8 GB of free RAM runs qwen3:8b; a GPU or Apple silicon makes answers much faster. No
API key is needed.

### Set up

```bash
git clone https://github.com/CherukuriSiva/Cairnly.git cairnly && cd cairnly

# 1. Models (about 5.5 GB in all)
ollama pull nomic-embed-text
ollama pull qwen3:8b

# 2. Settings: the defaults in .env.example work for this local setup
cp .env.example .env

# 3. Database: Postgres 17 + pgvector on port 5434
docker compose up -d db

# 4. API dependencies (drop --extra rerank to skip the cross-encoder reranker)
uv sync --extra rerank

# 5. Tables, then index every lesson (a few minutes on first run; later runs embed only changed files)
uv run cairnly migrate
uv run cairnly ingest --kb lessons

# 6. Site dependencies
cd web && npm install && cd ..
```

### Run

In two terminals:

```bash
uv run cairnly serve                 # API on http://localhost:8010
cd web && npm run dev                # site and chat on http://localhost:3010
```

### Check that it works

```bash
curl -s localhost:8010/health        # {"status":"ok", ...}
curl -s localhost:8010/config        # {"providers":["ollama"],"default_provider":"ollama"}
uv run cairnly ask "What is RAG and when does it beat pure prompting?"
```

Then open http://localhost:3010/ask and click a starter question. The answer streams in with
`[n]` citations that open the lesson section they came from. Reload the page: the chat comes
back from the database. http://localhost:3010/ask?demo=1 replays recorded answers (a cited
answer, a refusal, a guard block, a slow cold start and an error mid-answer) without the API.

After pulling a new version, run `uv run cairnly migrate` again: it is safe to re-run and
creates any new tables (for example the saved-conversation tables).

### Common problems

| Symptom | Fix |
|---|---|
| `connection refused` on port 5434 | Start the database: `docker compose up -d db` |
| Every question says "not in the lessons" | The index is empty: run `uv run cairnly ingest --kb lessons` |
| `model "qwen3:8b" not found` | `ollama pull qwen3:8b` (and `nomic-embed-text`), and make sure Ollama is running |
| The chat shows "Waking up the model…" for a long time | The first answer loads qwen3:8b into memory; later answers are faster |
| The chat cannot reach the API | Start `uv run cairnly serve`; for another address set `NEXT_PUBLIC_API_URL` and add the site to `CORS_ORIGINS` |
| `429 Too Many Requests` | The local rate limits from `.env` apply to you too; raise `RATE_LIMIT_PER_MINUTE` for testing |
| The chat forgets the conversation on reload, or votes are missing | `/config` has no `features` (an older API) or the conversation tables are missing: run `uv run cairnly migrate` and restart the API |

### Voice mode (optional)

Talk to the chat and hear the answer. It needs a third process, the voice server, and about
2 GB of speech models (downloaded on first start):

```bash
uv sync --extra voice --extra voice-models     # Pipecat, faster-whisper, Kokoro (no PyTorch)
CORS_ORIGINS=http://localhost:3010 uv run cairnly voice-serve   # voice server on :8020
cd web && NEXT_PUBLIC_VOICE_URL=http://localhost:8020 npm run dev
```

Open http://localhost:3010/ask: a microphone appears next to Ask. The page asks the voice server
nothing until you click it (in production that would wake a GPU for every visit); the click
wakes it, with a "Waking the voice model…" counter, and starts the call. A call greets you, captions
what you say and what it answers, lets you talk over it, and ends after 5 minutes, 50 quiet
seconds or a "goodbye"; the spoken turns then show in the chat. `?transport=webrtc` uses
peer-to-peer WebRTC instead of the WebSocket. `VOICE_FAKE_MODELS=1` runs the server without
models (scripted speech, a tone for the voice). Settings: `.env.example`, `VOICE_*`.

`http://localhost:3010/ask?q=your+question&track=ai-engineering` opens the chat with a question
already asked and the search limited to one track. Every lesson page has an "Ask Cairnly
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
uv sync --extra voice --extra voice-models --group voice-bench
uv run python evals/voice_bench.py --e2e                    # speech to text, text to speech, voice turns
```

CI runs the lessons eval on all content with real embeddings and the red-team gate, and fails
the build when a metric breaks `evals/gates.yaml`.

## Tests

```bash
uv run pytest -m "not db"          # fast unit tests, no services needed
uv run pytest                      # everything (needs `docker compose up -d db`)
cd web && npm test                 # syllabus, links, anchors, quiz and the chat engine
```

Tests use fake embedders and LLMs, so they need neither Ollama nor an API key. The chat engine
is tested through its replay transport with recorded event streams and fake timers. Voice
tests (with `--extra voice`) run real Pipecat pipelines with fake speech: an energy VAD,
scripted transcripts, a tone for the voice, and a WebSocket client; the browser side runs on a
fake adapter. CI runs lint,
tests against a real pgvector container, the eval gate with real embeddings, Terraform and
Helm validation, both image builds, and the web tests and build.

## Deploy

The default production route runs on free and hobby plans
([ADR 0017](docs/adr/0017-free-tier-production.md)): the site on Vercel, the API on Modal
([deploy/modal_api.py](deploy/modal_api.py), one container that switches off when idle), the
models on a Modal T4 GPU ([deploy/modal_ollama.py](deploy/modal_ollama.py)) and Postgres +
pgvector on Neon. Every secret lives in one Modal secret, `cairnly-api`. Voice mode is a third,
optional Modal app on a T4 GPU ([deploy/modal_voice.py](deploy/modal_voice.py)); the site shows
the microphone only when it is built with `NEXT_PUBLIC_VOICE_URL`.

See [infra/README.md](infra/README.md) for the steps, and for the other routes: Docker Compose,
Kubernetes (`scripts/kind-up.sh`), and AWS (ECS Fargate + RDS + ALB) deployed by a GitHub
Actions workflow with no stored AWS keys.
The web image is built from the repository root (`docker build -f web/Dockerfile .`) because
its pages are generated from `content/`.

## Project layout

```
content/          lessons, insights and roadmaps (MDX) + syllabus.yaml
src/cairnly/      the Python package: ingest, search, answer, guard, limits, API, CLI, voice/
web/              Next.js site and chat (web/lib/chat and web/lib/voice: no React)
evals/            written questions, off-topic, follow-up and red-team sets + CI gates
prompts/          versioned answer and rewrite prompts
deploy/           Modal apps: the API with its jobs, Ollama on a GPU, the voice server
infra/            Helm chart, Terraform for AWS, deploy guide
tests/            pytest suite (fake models, optional real database)
docs/             LEARN-M1..M4 and LEARN-CHAT write-ups and ADRs
```

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
[CC BY-NC-SA 4.0](content/LICENSE.md). Insights summarize other people's public posts,
mostly LinkedIn infographics; the ideas belong to their authors, and each insight credits its
source at the bottom of the page (by name where the post shows one). Book notes are short
summaries in our own words. If you wrote a source and want a credit, a link or a removal,
open an issue.

## Contributing

Bug reports, lesson fixes and code are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md);
issues labelled `good first issue` are small and self-contained.
