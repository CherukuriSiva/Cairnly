# cairnly

A deployable AI knowledge assistant. Point it at a folder of docs and ask questions; answers
stream back with citations to the exact sections they came from.

Built in public, milestone by milestone. Milestone 1 (this version) is the core RAG loop.

## What M1 does

```
lessons (.mdx) --curate--> corpus/*.md --ingest--> Postgres (text + pgvector)
                                                        |
question --> hybrid search (full-text + vector, RRF) --> confidence gate --> LLM --> streamed answer + citations
```

- **Curation**: converts MDX lessons to plain markdown and records what was kept or dropped ([CURATION.md](CURATION.md)).
- **Ingestion**: one chunk per heading section, embedded with a local model, re-run safely (only changed files are re-embedded).
- **Retrieval**: Postgres full-text search and pgvector similarity, merged with Reciprocal Rank Fusion.
- **Generation**: local Ollama by default, Claude API as an option, behind one provider interface.
- **API**: FastAPI with a streaming `/ask` endpoint. **UI**: Next.js chat in `web/`.

## Quick start

Needs: [uv](https://docs.astral.sh/uv/), Docker, and [Ollama](https://ollama.com) with two models:

```bash
ollama pull nomic-embed-text
ollama pull qwen3:8b

cp .env.example .env            # defaults work as-is for the local setup
docker compose up -d db         # Postgres + pgvector on port 5434
uv sync
uv run cairnly migrate          # create tables
uv run cairnly ingest corpus    # chunk + embed + store
uv run cairnly ask "What is RAG and when does it beat prompting?"
uv run cairnly serve            # API on http://localhost:8010
```

## Tests

```bash
uv run pytest -m "not db"       # fast unit tests, no services needed
uv run pytest                   # everything (needs `docker compose up -d db`)
```

## Docs

- [docs/LEARN-M1.md](docs/LEARN-M1.md): how and why each piece works, in plain English.
- [docs/adr/](docs/adr/): the main design decisions.
