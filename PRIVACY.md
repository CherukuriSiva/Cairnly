# Privacy

cairnly has no accounts, no sign-in and no cookies. This page lists everything it keeps about a
visit, where, and for how long. The tracing design is in
[ADR 0015](docs/adr/0015-privacy-safe-tracing.md).

## What the chat sends

Each question goes to the API with:

- the question and up to 6 earlier questions and answers from the same chat (for follow-ups),
- the track the chat is limited to, if any,
- a **session id**: a random id made by your browser tab (`crypto.randomUUID()`) and kept in that
  tab's `sessionStorage`. A new tab gets a new id. It is not linked to you, your device or your
  IP address; it only lets an operator see that two questions came from the same conversation.

The chat stores nothing else in your browser.

## What the server keeps

| What | Where | How long |
|---|---|---|
| Your IP address and request counts, for rate limits | the API's memory only, never written to disk | until the process restarts; addresses from past days are dropped once more than 10,000 are held |
| API logs | the default deploy: the API app's logs on Modal; the AWS deploy: Uvicorn access logs (client address, path, status code, time) in CloudWatch | Modal's log retention; 14 days on AWS (the log group retention) |
| Traces (see below) | the operator's Langfuse project (Langfuse Cloud, US region, on the default deploy) | the retention set in that project |

On AWS, behind the load balancer, the client address in the API's access logs is usually the
load balancer's own address. Load balancer access logs are not turned on.

Questions and answers are not stored in the database. The database holds only the lessons.

## What a trace holds

Each question can produce one trace in Langfuse, used to find slow or wrong answers. By default
a trace holds **no question or answer text**. It holds:

- a short fingerprint (the first 16 hex characters of a SHA-256 hash) and the length of the
  question,
- how many earlier turns were sent, the knowledge base and the track,
- which guard rule ran and whether it blocked,
- the titles and paths of the lesson sections that were retrieved, and the best similarity,
- the model, prompt version, token counts, timings, errors and scores (refused, blocked,
  uncited),
- the session id.

It never holds your IP address or a user id.

`TRACE_CONTENT=1` adds the question, the searched query and the answer text to traces. It is
meant for local debugging only and is off in every deploy config.

## The model

In production, answers come from an open model (qwen3:8b) running on a Modal GPU that only the
cairnly API can call. Your question and the retrieved lesson text are sent to it to write the
answer; Ollama does not keep them after the answer is written. No question is sent to a
third-party AI API.

## Questions

Open an issue on the GitHub repository.
