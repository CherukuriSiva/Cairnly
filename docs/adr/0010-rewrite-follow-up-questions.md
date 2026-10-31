# ADR 0010: Rewrite follow-up questions before search

Status: accepted (M3)

## Context

The M3 chat keeps a conversation. A follow-up such as "How do I evaluate it?" retrieves nothing
useful on its own, because the topic lives in an earlier turn. Sending the whole conversation to
search adds noise, and sending it to the answer prompt alone does not fix retrieval.

## Decision

When the client sends earlier turns (at most 6, each answer at most 4000 characters, validated
by the API), one extra LLM call (`prompts/rewrite-v1.md`) turns the follow-up into a standalone
question. Search and the answer prompt use that question; the `done` event reports it as
`query`, the chat shows it as "Searched: ...", and tracing records a `rewrite` step. With no
history there is no extra call. Any failure (an exception, an empty, multi-line or overlong
reply) falls back to the original question. The rewrite prompt treats the conversation as data.

## Consequences

- Follow-ups find the right lessons; first questions cost nothing extra.
- Each follow-up adds one LLM round trip before search, which shows up as latency.
- The rewrite can lose or change meaning. `cairnly eval-followups` compares search recall of
  the rewritten follow-ups with hand-written standalone questions (15 items). With qwen3:8b on
  2026-11-01 both scored Recall@5 0.867, and both 0.933 after two lessons were edited and
  re-ingested (the index changed, not the rewrite); some rewrites still left a vague word
  ("that setup") unresolved.
- History comes from the client, so it is untrusted: the API caps its size and the prompts
  never let it act as instructions.
