# Deploying cairnly

Four ways to run it, from laptop to cloud:

| Where | How | What runs |
|---|---|---|
| Laptop (Docker) | `docker compose --profile full up -d --build` | db, api, web; Ollama on the host |
| Laptop (Kubernetes) | `scripts/kind-up.sh` | the Helm chart on a local kind cluster |
| Vercel + Modal + Neon (default) | [the steps below](#vercel--modal--neon-default-free-tier) | the site on Vercel, the API and the models on Modal, Postgres on Neon; free and hobby plans ([ADR 0017](../docs/adr/0017-free-tier-production.md)) |
| AWS + Modal | [the AWS steps](#aws-architecture) | ECS Fargate + RDS + ALB, deployed by GitHub Actions; the models on a Modal GPU |

The Helm chart's defaults run everything in the cluster, an in-cluster Ollama included, for
kind. For a real cluster, `infra/helm/cairnly/values-production.yaml` turns off the in-cluster
Ollama and Postgres, points at the Modal URL with the proxy-token secret, and sets
`api.environment: production` and `api.trustProxy: "1"`.

## Vercel + Modal + Neon (default, free tier)

```
browser ─▶ Vercel: the Next.js site (static pages, News refreshed hourly)
browser ─▶ Modal: cairnly-api (FastAPI, one CPU container) ─┬─▶ Neon: Postgres + pgvector
                                                           └─▶ Modal: cairnly-ollama (one T4 GPU, proxy auth)
```

- Both Modal apps switch off after 5 idle minutes and run at most one container each. One API
  container means the rate limits and answer slots hold for the whole site.
- Every secret lives in the Modal secret `cairnly-api`; the API app reads nothing else from
  the workspace. Its keys: `DATABASE_URL`, `MODAL_PROXY_TOKEN_ID`, `MODAL_PROXY_TOKEN_SECRET`,
  `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`. Never write a value into the
  repo, a doc or a log.
- The non-secret settings are in [deploy/modal_api.py](../deploy/modal_api.py): production
  mode (Claude can never be switched on), Ollama as the provider, `TRUST_PROXY=0` (Modal hands
  the API the real caller's address) and `CORS_ORIGINS`, the Vercel production site.

You need: Modal, Neon and Vercel accounts (a personal Vercel Hobby account; Hobby is for
non-commercial use), [uv](https://docs.astral.sh/uv/), Node 20, and the GitHub repo pushed.
Run every command from the repo root.

1. **Models on Modal:** `uvx modal deploy deploy/modal_ollama.py`. In the Modal dashboard,
   create a Proxy Auth Token (Settings → Proxy Auth Tokens) and set a **spend limit** (Usage &
   Billing).
2. **Database on Neon:** create a project and copy its **unpooled** connection string (with
   `sslmode=require`). The pooled one breaks psycopg's prepared statements. `migrate` creates
   the `vector` extension itself.
3. **The secret:** in the Modal dashboard, Secrets → create a custom secret named `cairnly-api`
   with the keys listed above (`LANGFUSE_HOST` is e.g. `https://us.cloud.langfuse.com`; leave
   out the Langfuse keys for no tracing). Traces hold no question or answer text
   ([PRIVACY.md](../PRIVACY.md)).
4. **The API:** `uvx modal deploy deploy/modal_api.py`. It prints the API URL,
   `https://<workspace>--cairnly-api-web.modal.run`.
5. **Check every key:** `uvx modal run deploy/modal_api.py::check`. It prints one PASS or FAIL
   line per check (database, Ollama with the token, Ollama without it must be 401, Langfuse),
   never a value, and fails when any check fails.
6. **Fill the database:** `uvx modal run deploy/modal_api.py::ingest` (migrate, then every
   knowledge base in `kbs.yaml`). It prints how many chunks were embedded.
7. **The site on Vercel:** import the GitHub repo in the Vercel dashboard under your personal
   account. Root Directory `web`, framework Next.js, and turn on "Include files outside the
   root directory in the Build Step" (the build reads `../content`). Add the environment
   variable `NEXT_PUBLIC_API_URL` = the API URL for Production, then deploy. Every push to
   `main` deploys again. A CLI deploy (`npx vercel@latest deploy --prod` from the repo root)
   uploads only `web/` and `content/` ([.vercelignore](../.vercelignore)).
8. **CORS:** if the site's production domain is not `https://cairnly.vercel.app`, set it in
   `CORS_ORIGINS` in `deploy/modal_api.py` and deploy the API again.
9. **Smoke test:** `curl <api>/health` answers 200, `curl <api>/config` lists only Ollama, and
   a question in the chat on the site gets a cited answer.

| Situation | Do this |
|---|---|
| Ship a new API version | `uvx modal deploy deploy/modal_api.py` |
| Ship a new site version | Push to `main`; Vercel builds it |
| Lessons changed | Push, then `uvx modal run deploy/modal_api.py::ingest`; only changed files are re-embedded |
| Rotate a key | Edit the value in the `cairnly-api` secret, then `uvx modal deploy deploy/modal_api.py` so new containers read it; run `check` |
| Stop everything | `uvx modal app stop cairnly-api` and `uvx modal app stop cairnly-ollama`; the site then answers questions with an error |
| First question after a quiet period is slow | Expected: the API container and then the GPU wake up. The API waits up to 90 s for the first token; Modal ends a web request after 150 s, so a slower start ends with "did not respond in time" |
| `/health` returns 503 | The database is unreachable: check the Neon project and that `DATABASE_URL` is the unpooled string |
| Search and answers fail with 401 from Modal | The proxy token in the secret is wrong: fix it, redeploy the API, run `check` |
| Readers get 429 | A rate limit or the daily cap was reached; with one API container the limits are site-wide |
| The browser shows a CORS error | `CORS_ORIGINS` in `deploy/modal_api.py` does not match the site's domain |
| Modal bill grows | Check the spend limit and that both apps still set `max_containers=1` |

## AWS architecture

```
internet ─▶ ALB (public subnets) ─┬─ /ask /search /kbs /config /health /livez ─▶ api (ECS Fargate, 1-4 tasks)
                                  └─ everything else ─────────────────────────▶ web (ECS Fargate)
private subnets:  api ─▶ RDS Postgres 17 + pgvector          secrets ─▶ Secrets Manager
                  api ─▶ (NAT, HTTPS, proxy-auth token) ─▶ Modal: Ollama on one T4 GPU
                                                           (qwen3:8b answers, nomic-embed-text embeddings)
```

- Nothing but the load balancer is reachable from the internet. The Modal endpoint is public
  but answers 401 to any request without the proxy-auth token, which only the API holds.
- The database password is generated by RDS and the Modal token is put into Secrets Manager
  by you. Neither is ever in Terraform state, the repo or CI logs.
- The Claude API is not part of any deploy: the API runs with `CAIRNLY_ENV=production`, which
  refuses to enable it ([ADR 0013](../docs/adr/0013-models-on-a-modal-gpu.md)).
- The API limits requests per IP (`TRUST_PROXY=1`: the client is the last `X-Forwarded-For`
  entry, the one the ALB appended), caps answers per day and runs at most 4 at once
  ([SAFETY.md](../SAFETY.md)).
- A deploy that never becomes healthy rolls itself back (ECS deployment circuit breaker).
- Daily database backups with 7 days of point-in-time restore.

**Rough cost** (us-east-1, idle demo): NAT gateway ~$33, load balancer ~$18, RDS
db.t4g.micro ~$13, Fargate (api + web) ~$27, logs and secrets ~$3, so about **$95/month** on
AWS. The Modal T4 costs about $0.59 per hour, billed per second only while a container is up
(it switches off after 5 idle minutes); Modal's Starter plan includes $30 of credit a month.
`terraform destroy` removes the AWS part (set `deletion_protection=false` first);
`uvx modal app stop cairnly-ollama` stops the GPU app.

## AWS first deploy (about 30 minutes)

You need: an AWS account, the AWS CLI logged in as an admin, Terraform 1.6+, a Modal account,
[uv](https://docs.astral.sh/uv/), and the GitHub repo already pushed.

1. **Models on Modal** (from the repo root):

   ```bash
   uvx modal setup                                  # log in once
   uvx modal deploy deploy/modal_ollama.py          # builds the image with both models; prints the URL
   ```

   Then, in the Modal dashboard: Settings → Proxy Auth Tokens → create a token (you get an id
   `wk-...` and a secret `ws-...`), and Usage & Billing → set a **spend limit**.

2. **Bootstrap once** (state bucket + a GitHub deploy role, no AWS keys in GitHub):

   ```bash
   cd infra/bootstrap
   terraform init
   terraform apply -var github_repo=CherukuriSiva/cairnly    # prints state_bucket and deploy_role_arn
   ```

3. **Tell GitHub** (repo Settings → Secrets and variables → Actions):
   - variables: `AWS_REGION` = `us-east-1`, `TF_STATE_BUCKET` = the `state_bucket` output,
     `OLLAMA_URL` = the URL `modal deploy` printed, and optionally `LANGFUSE_HOST`
     (e.g. `https://cloud.langfuse.com`; leave it unset for no production tracing)
   - secret: `AWS_DEPLOY_ROLE_ARN` = the `deploy_role_arn` output
   - create an environment named `production` (optionally require your approval for it)

4. **Deploy:** Actions tab → `deploy` → Run workflow. It pushes images, applies Terraform,
   runs the migrate + ingest job and smoke-tests the URL it prints. The first ingest fails
   until step 5 is done (the token is still a placeholder); re-run the workflow after it.

5. **Add the Modal token** (embeddings and answers need it):

   ```bash
   aws secretsmanager put-secret-value --secret-id cairnly/modal-proxy-token \
     --secret-string '{"token_id":"wk-...","token_secret":"ws-..."}'
   aws ecs update-service --cluster cairnly --service api --force-new-deployment
   ```

   With `LANGFUSE_HOST` set, put the Langfuse keys in the same way:

   ```bash
   aws secretsmanager put-secret-value --secret-id cairnly/langfuse \
     --secret-string '{"public_key":"pk-lf-...","secret_key":"sk-lf-..."}'
   ```

   Traces hold no question or answer text ([PRIVACY.md](../PRIVACY.md)). Set the trace
   retention in the Langfuse project.

6. **HTTPS:** request an ACM certificate for your domain, then run Terraform with
   `-var certificate_arn=<arn>` and point a DNS record at the load balancer.

## AWS runbook

| Situation | Do this |
|---|---|
| Ship a new version | Run the `deploy` workflow (images are tagged with the commit SHA) |
| Docs changed | Re-run the ingest step: `eval "$(terraform output -raw run_ingest)"`; only changed files are re-embedded |
| `/health` returns 503 | Database unreachable: check RDS status and the `db` security group |
| First answer after a quiet period is slow | Expected: the Modal GPU is cold-starting (tens of seconds). The chat shows "Waking up the model…"; the API waits up to 90 s for the first token |
| "The model did not respond in time" | The cold start took longer than 90 s, or Modal is down: check the app in the Modal dashboard |
| Search and answers fail, API logs show 401 from Modal | The Modal token is wrong or still the placeholder: fix `cairnly/modal-proxy-token`, then force a new api deployment |
| Readers get 429 | A rate limit or the daily cap was reached (`RATE_LIMIT_*`, `GLOBAL_ANSWERS_PER_DAY`); limits are per API task |
| Readers get 503 "Too many answers" | 4 answers are running in one task; scale api tasks or raise `MAX_CONCURRENT_ANSWERS` and Ollama's `OLLAMA_NUM_PARALLEL` together |
| Modal bill grows | Check the spend limit and that `max_containers=1` is still set in `deploy/modal_ollama.py` |
| Roll back | Re-run `deploy` from an older commit, or `terraform apply -var image_tag=<old sha>` |
| Restore the database | RDS console → point-in-time restore → new instance, then update `DB_HOST` via Terraform |

## Not covered yet (later milestones)

Multi-tenancy, auth and per-tenant quotas (M7), Prometheus/Grafana dashboards, SLO alerts and
load tests (M8). CloudWatch logs and Container Insights are on from day one.
