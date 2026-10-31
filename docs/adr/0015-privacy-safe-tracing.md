# ADR 0015: Privacy-safe production tracing

Status: accepted (M4). Amends [ADR 0008](0008-tracing-with-langfuse.md).

## Context

ADR 0008 traced every question with its full text: the question, the rewritten query and the
answer. That is fine on a laptop, but on a public site it would store what strangers typed in a
third-party service, sometimes with personal details in it. An operator still needs to debug a
slow or wrong answer.

## Decision

- **No user text by default.** Traces hold a 16-character SHA-256 fingerprint and the length of
  the question, the number of earlier turns, the knowledge base and track, the guard verdict,
  the citations of the retrieved sections (lesson titles and paths, not user data), the best
  similarity, answer length and whether it cited, token usage, timings and errors.
  `TRACE_CONTENT=1` adds the question, query and answer for local debugging only.
- **Every step is traced:** guard, rewrite (follow-ups), retrieve, generate and output check.
- **Sessions, not users.** The chat makes a random id per browser tab and sends it with each
  question; the trace groups follow-ups by it. No user id and no IP address are ever traced.
- **Outcomes are searchable.** Each trace records the prompt version, the environment and
  release (from `LANGFUSE_TRACING_ENVIRONMENT` and `LANGFUSE_RELEASE`), tags for the knowledge
  base and track, and scores: `refused`, `top_similarity`, `guard_blocked`, `uncited`.
- **Errors are marked.** An exception marks the open step and the trace `ERROR` with the
  exception class name only; timeouts say which limit was hit; a client that leaves mid-answer
  is a `WARNING`.
- **Tracing never costs an answer.** Every call into the Langfuse SDK swallows its errors, and
  the API flushes and shuts the client down when it stops.
- Infra passes the Langfuse host and keys (from Secrets Manager or a Kubernetes secret) only
  when a host is set; otherwise tracing is off.

## Consequences

- Two traces of the same question have the same fingerprint, so repeated questions can still
  be counted without reading them.
- An operator cannot see what a user asked. To debug a specific wrong answer, reproduce it
  locally with `TRACE_CONTENT=1`.
- The fingerprint is not anonymization: anyone who guesses the exact question can confirm it.
  It is a short hash of free text, which is good enough for a learning site.
- Retention is set in the Langfuse project, not in cairnly (PRIVACY.md says so).
