# ADR 0017: Free-tier production on Vercel, Modal and Neon

Status: accepted. Replaces [ADR 0007](0007-aws-ecs-fargate.md) as the default deploy; the AWS
route stays as the documented alternative.

## Context

The AWS deploy from M2 was never applied. Idle, it costs about $95 a month (NAT gateway, load
balancer, RDS and two Fargate services), which is too much for a public learning site with few
readers. The owner already has personal free or hobby accounts on Vercel, Modal and Neon, and
the models already run on Modal ([ADR 0013](0013-models-on-a-modal-gpu.md)).

## Decision

- **Site on Vercel.** The Next.js site deploys from the GitHub repo to the owner's personal
  Hobby account, with `web` as the root directory. The build reads `../content`, so files
  outside the root directory are included. `NEXT_PUBLIC_API_URL` points at the Modal API.
  A `.vercelignore` allowlist uploads only `web/` and `content/` from a CLI deploy.
- **API on Modal.** `deploy/modal_api.py` serves the FastAPI app from an image built like the
  Dockerfile (reranker baked in). It runs at most one container and switches off after 5 idle
  minutes. The same app has two one-off jobs: `ingest` (migrate, then ingest every knowledge
  base) and `check` (every key and service, reporting names and pass or fail only).
- **Models on Modal, unchanged.** `deploy/modal_ollama.py` as in ADR 0013.
- **Database on Neon.** Postgres with pgvector on Neon's free plan, reached with the unpooled
  connection string (the pooled one breaks psycopg's prepared statements).
- **One secret.** Every secret (database URL, Modal proxy token, Langfuse keys) lives in the
  Modal secret `cairnly-api`. The API app reads only that secret, never the other secrets in
  the workspace. Non-secret settings (`CAIRNLY_ENV=production`, `LLM_PROVIDER=ollama`,
  `TRUST_PROXY=0`, `CORS_ORIGINS`) are set in the deploy module.
- **Claude stays local only.** Nothing in this route holds or names an Anthropic key, and
  `CAIRNLY_ENV=production` refuses `ALLOW_ANTHROPIC`.

## Consequences

- Cost: Vercel Hobby and Neon's free plan cost nothing. Modal bills the API CPU container and
  the T4 GPU per second, only while they are up, against the $30 monthly credit.
- Cold starts add up: after a quiet period the first question waits for the API container and
  then for the GPU container and the model load. The API waits up to 90 s for the first token,
  and Modal ends any web request after 150 s, so a very slow cold start ends with the in-band
  "did not respond in time" message.
- The rate limits and answer slots are per process. With one API container they hold for the
  whole site; scaling the API out would need a shared store first.
- Modal hands the API the caller's real address, so `TRUST_PROXY` stays off. Turning it on
  would let anyone forge `X-Forwarded-For` to dodge the limits.
- Neon's free plan holds 0.5 GB, plenty for the lessons; it suspends when idle and wakes on the
  first query.
- Vercel Hobby is for non-commercial use only. A commercial deploy needs a paid plan or the
  AWS route.
- The AWS route (Terraform, Helm, the deploy workflow) is kept and still documented in
  [infra/README.md](../../infra/README.md).
