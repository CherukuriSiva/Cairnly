# Learn M1: the core RAG loop

What Milestone 1 builds, how each piece works, and why it was built that way. Read top to
bottom; each section matches one module in `src/cairnly/`.

```
lessons (.mdx) ─curate─▶ corpus/*.md ─ingest─▶ Postgres ─search─▶ top chunks ─answer─▶ streamed, cited answer
```

## 1. Curation (`curate.py`)

> **Replaced in M3 (2026-10-31).** All content is now public, so there is no curation step and
> no `corpus/` folder: lessons live in `content/` as MDX, and `mdx.py` converts them while
> ingesting. See [LEARN-M3](LEARN-M3.md). This section is kept as history.

The source lessons are MDX: markdown plus React components like `<WhyThisMatters>`. A RAG
system should index what a reader sees, not website code, so curation turns each component
into a plain markdown heading (`## Why this matters`) and removes wrappers like `<Body>`.

Three rules keep it honest:

- **Code fences are never touched.** A lesson about Next.js contains `<PageShell>` inside a
  code block; that is content, not a component.
- **Every file gets a decision and a reason** in `CURATION.md` (deleted in M3): `public`,
  `local-only` or `dropped`. Unknown components are flagged, not silently deleted.
- **Not everything is publishable.** Paid lessons and insights built from other people's posts
  are converted into `corpus/private/` (git-ignored), so the local demo can use them but the
  public repo does not ship them.

## 2. Chunking (`chunk.py`)

An LLM can only read a few thousand words of context per answer, so documents are cut into
**chunks**. cairnly cuts at headings (`##`, `###`): one chunk per section.

Why headings and not "every 500 tokens"? A section is a unit a person would cite. The citation
`What is RAG > When RAG beats pure prompting (lines 12-18)` means something; "tokens 500-1000"
does not. Long sections still split, but only at blank lines and never inside a code block.

Each chunk keeps its **heading trail** (`Hybrid Search > Fuse the two with RRF`). The trail is
embedded together with the text, which helps a short section like "Quick quiz" be found by
what lesson it belongs to.

## 3. Embeddings (`embed.py`)

An embedding turns text into a list of numbers (768 of them here) so that texts with similar
meaning end up close together. cairnly uses `nomic-embed-text`, running locally in Ollama:
free, private, and fast enough (162 lessons embed in about 17 seconds on a laptop).

Gotcha worth knowing: nomic was trained with **task prefixes**. Documents are embedded as
`search_document: ...` and questions as `search_query: ...`. Forgetting them does not crash
anything; it just quietly makes search worse. That is why the prefixes live in one module.

## 4. Storage and incremental sync (`db.py`, `ingest.py`)

Everything lives in one Postgres database with the `pgvector` extension:

| Table | One row per | Key columns |
|---|---|---|
| `documents` | source file | `path`, `title`, `sha256` |
| `chunks` | section | `trail`, `start_line`, `end_line`, `text`, `tsv`, `embedding` |

`tsv` is a full-text search column Postgres builds automatically; `embedding` is a
`vector(768)` with an HNSW index for fast nearest-neighbour search.

**Incremental sync:** each file's SHA-256 hash is stored. Re-running `cairnly ingest` skips
unchanged files (no embedding calls), re-chunks changed ones, and deletes rows for files that
disappeared. Second run on the full corpus: `unchanged 162, 0 chunks embedded`.

## 5. Hybrid search (`search.py`)

Two searches run for every question:

- **Keyword** (Postgres full-text): great at exact terms like `RRF` or `pgvector`.
- **Vector** (pgvector cosine similarity): great at meaning, e.g. "make answers cite sources"
  finds a section that never uses those words.

Their scores are on different scales, so they are merged with **Reciprocal Rank Fusion**,
which only looks at positions: `score = Σ 1 / (60 + rank)`. A chunk ranked well by both lists
beats a chunk ranked first by only one.

Honest note: Postgres `ts_rank_cd` is not true BM25 (it ignores how common a word is across
the whole corpus). It is a good start; a real BM25 extension is a candidate for later.

## 6. The confidence gate and the answer (`answer.py`)

Before calling the LLM, cairnly checks the **best cosine similarity**. On the real corpus,
on-topic questions score 0.78-0.85 and an off-topic one ("best pizza in Dubai") scores 0.48.
Below the knowledge base's `min_score` (0.55, in `kbs.yaml`) it refuses instead of letting the model answer from memory.

The 0.55 is a first guess from a handful of questions. M2 adds a golden set of questions to
measure it properly.

When confident, the top chunks are numbered `[1]..[n]` in the prompt and the system prompt
requires a `[n]` citation for every claim. It also tells the model to treat source text as
data, the first small defence against prompt injection (M4 does this properly).

## 7. Providers (`llm.py`)

The app talks to one interface: `stream(system, prompt)` yields text. Two implementations:

- **Ollama** (`qwen3:8b`, default): free and local. `think: false` skips qwen3's slow
  "thinking" phase, which a grounded Q&A answer does not need.
- **Claude API** (`claude-opus-5-5`): set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`.
  It runs at low effort (grounded answers are a light task) with server-side fallback on.

Tests use a fake provider, so CI never needs a model or an API key.

## 8. Streaming API and UI (`api.py`, `web/`)

`POST /ask` returns **Server-Sent Events**: a stream of `data: {json}` lines. The order is
always `sources`, then many `token` events, then `done`. The UI shows sources immediately,
types the answer as it arrives, and turns each `[n]` into a chip that highlights its source.

## Try it

```bash
uv run cairnly search "reciprocal rank fusion"    # see what retrieval finds, with scores
uv run cairnly ask "What is RAG?"                  # full answer in the terminal
uv run cairnly serve & (cd web && npm run dev)     # then open http://localhost:3010
```

## What M1 does not do yet

No evaluation numbers (M2), no tracing (M2), no guardrails beyond the prompt rule (M4), no
cache or rate limits (M4), single tenant only (M7). Each is a later milestone on purpose.
