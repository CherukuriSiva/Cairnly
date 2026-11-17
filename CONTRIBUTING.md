# Contributing to Cairnly

Thanks for helping. Cairnly is a learning site and a RAG reference app, so there are two kinds
of contribution: fixing or improving the lessons, and changing the code.

## Before you start

- For anything bigger than a typo, open an issue first so we can agree on the approach.
- Issues labelled `good first issue` are small and self-contained.
- Be kind and specific in issues and reviews.

## Lessons and other content

Everything a learner reads lives in `content/` as MDX ([content/README.md](content/README.md)
explains the format and `syllabus.yaml` sets the order).

- Write in plain English, in your own words. Don't paste text from books, courses or posts;
  summarize and link instead.
- Keep each change focused: one lesson or one fix per pull request.
- Content is licensed under CC BY-NC-SA 4.0 ([content/LICENSE.md](content/LICENSE.md)); by
  contributing content you agree to that license.
- After a content change, `cd web && npm test` checks the syllabus, links, anchors and quizzes.

## Code

Set up the project with the [Installation](README.md#installation) steps, then:

```bash
uv run ruff check .                 # Python lint
uv run pytest -m "not db"           # fast tests, no services needed
uv run pytest                       # everything (needs `docker compose up -d db`)
cd web && npm run lint && npm test && npm run build
```

- Tests use fake embedders, LLMs and speech, so you need neither Ollama nor an API key to run
  them. Add a test for every behavior you change.
- Retrieval or prompt changes must keep the eval gate green:
  `uv run cairnly eval --kb lessons --gate evals/gates.yaml`.
- Keep the existing protections: rate limits, the input guard, the confidence gate and
  privacy-safe tracing ([SAFETY.md](SAFETY.md), [PRIVACY.md](PRIVACY.md)).
- A significant design choice gets a short ADR in `docs/adr/`.
- Code is licensed under MIT ([LICENSE](LICENSE)); by contributing code you agree to that
  license.

## Pull requests

1. Fork, create a branch, make your change with tests.
2. Run the checks above.
3. Open the pull request with what changed, why, and how you tested it.

## Security

Please don't open a public issue for a security problem (for example a way around the input
guard that leaks data, or a way to run up the hosting bill). Use GitHub's private
"Report a vulnerability" option on the repository's Security tab instead.
