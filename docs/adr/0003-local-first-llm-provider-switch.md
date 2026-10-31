# ADR 0003: Local-first LLMs behind one provider interface

Status: accepted (M1). Superseded in part by [ADR 0013](0013-models-on-a-modal-gpu.md): Claude
is no longer a production option; it works only locally with `ALLOW_ANTHROPIC=true`.

## Context

The demo must run for free on a laptop, but a customer deployment may want a hosted frontier
model. Vendor SDK calls spread through the code make switching expensive.

## Decision

Embeddings and the default chat model run locally in Ollama. Generation goes through a small
`LLM` protocol (`stream(system, prompt) -> Iterator[str]`) with two implementations, Ollama and
the Claude API, selected by `LLM_PROVIDER` or per request.

## Consequences

- The demo costs nothing to run; the Claude path needs only an API key.
- Tests inject a fake LLM, so CI needs neither a model nor a key.
- Embeddings are not switchable yet: changing the embedding model means re-embedding the
  corpus, which needs a migration story (M6, versioned indexes).
