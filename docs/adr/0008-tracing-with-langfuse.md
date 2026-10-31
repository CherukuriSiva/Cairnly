# ADR 0008: Trace every question with Langfuse (optional, self-hostable)

Status: accepted (M2)

## Context

Debugging a wrong or slow answer needs the full story of one request: what was retrieved,
which prompt and model ran, and where the time went.

## Decision

One Langfuse trace per question with `retrieve` and `generate` children, enabled by setting
keys and a no-op otherwise. Self-hosted Langfuse v3 for local work
(`compose.observability.yaml`); Langfuse Cloud or a self-hosted server in production.

## Consequences

- Spans are passed explicitly because streaming responses can resume on different threads.
- Traces contain questions and answers, which is user data: production needs a retention
  policy and, for regulated customers, PII redaction before tracing (M3).
