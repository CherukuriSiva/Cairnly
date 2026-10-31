# ADR 0013: Production models on a Modal GPU; Claude is local only

Status: accepted (M4). Supersedes the production default of
[ADR 0003](0003-local-first-llm-provider-switch.md).

## Context

The AWS deploy from M2 answered with the Claude API and ran embeddings on a CPU Ollama task in
Fargate. Two problems showed up when we planned a free public deploy.

- A Claude API key is a paid credential that is meant for local development only. Any public
  deploy that can call Claude risks exposing the key, or letting strangers run up a bill on it.
- A CPU Fargate task is too slow to write answers with qwen3:8b, and an always-on GPU in AWS
  costs far more than a demo is worth.

We already run a fine-tuned model on Modal for another project (asterly). Modal bills GPU time
per second, scales to zero, and can lock an endpoint so only callers with a token get through.

## Decision

- **Models move to Modal.** `deploy/modal_ollama.py` runs Ollama on one T4 GPU with qwen3:8b and
  nomic-embed-text baked into the image. It switches off after 5 idle minutes and runs at most
  1 container. Modal proxy auth is on: requests need the `Modal-Key` and `Modal-Secret` headers,
  which only the API holds (from Secrets Manager).
- **The rest stays on AWS.** The API, web, database and load balancer are unchanged. The CPU
  Ollama task, its service discovery and security group are removed.
- **Claude is local only.** The Claude provider needs `ALLOW_ANTHROPIC=true`. A server with
  `CAIRNLY_ENV=production` refuses to start with it, and the production configs set that
  environment. Without it, `/ask` answers 403 for `provider=anthropic`, `GET /config` lists only
  Ollama, and the chat hides the choice. cairnly never reads the key itself: the Anthropic SDK
  picks it up from the developer's shell. No Terraform, Helm, CI or deploy file mentions it.

## Consequences

- Cost: a T4 on Modal is about $0.59 per hour, billed per second only while a container is up.
  Modal's Starter plan includes $30 of credit per month. `max_containers=1` caps the spend, and
  the owner sets a spend limit in Modal's billing page as a second cap.
- Cold start: after 5 idle minutes the first question waits for a container and for qwen3:8b to
  load, measured at about 40 seconds in asterly. The API waits up to 90 s for the first token,
  and the chat shows "Waking up the model..." after 5 s.
- One container serves everyone. Ollama runs 4 requests in parallel, matching the API's limit
  of 4 answers at once.
- The Modal URL is a Terraform variable (`ollama_url`) set from a GitHub repository variable;
  the token is a Secrets Manager secret filled in by hand once, like the database password.
- Answers in production come from an 8B open model, which is weaker than Claude. The
  measured faithfulness of qwen3:8b on the lessons (97.5%, LEARN-M2) is good enough for a
  learning site that always cites its sources.
