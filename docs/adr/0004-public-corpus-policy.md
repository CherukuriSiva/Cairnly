# ADR 0004: What content the public repo ships

Status: accepted (M1), pending the author's final call on paid lessons

Superseded on 2026-10-31 by ADR 0009: all content is public.

## Context

The demo corpus is the author's GradStack lessons: 162 files. 115 are paid lessons
(`isFreePreview: false`) and 29 insights are written from third-party posts.

## Decision

The repo commits only free lessons and roadmaps (18 files). Paid lessons and third-party-derived
insights are converted into `corpus/private/` (git-ignored) so the local demo still has the full
corpus. Every decision is recorded in `CURATION.md`.

## Consequences

- Publishing the repo does not give away paid content. Reversing this later is a one-line
  rule change in `curate.py`; the opposite (removing committed content) needs a history rewrite.
- A hosted public demo will only cover the public corpus unless the author decides otherwise.
