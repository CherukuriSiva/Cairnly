# Privacy

cairnly has no accounts, no sign-in and no cookies. This page lists everything it keeps about a
visit, where, and for how long. The tracing design is in
[ADR 0015](docs/adr/0015-privacy-safe-tracing.md).

## What the chat sends

Each question goes to the API with:

- the question,
- the **conversation id** of your saved chat (see below), or, when the API does not save
  conversations, up to 6 earlier questions and answers from the same chat (for follow-ups),
- the track the chat is limited to, if any,
- a **session id**: a random id made by your browser tab (`crypto.randomUUID()`) and kept in that
  tab's `sessionStorage`. A new tab gets a new id. It is not linked to you, your device or your
  IP address; it only lets an operator see that two questions came from the same conversation.

In your browser the chat keeps the session id (above) and the conversation id, in
`localStorage` under `cairnly.conversation.v1`, so a reload brings the chat back. Nothing else.
"New chat" forgets the id. The demo at `/ask?demo=1` replays recordings and sends nothing.

## Voice mode

When you start a call, your browser streams your microphone to the voice server (a separate
app, `cairnly-voice`) for the length of the call, and plays its answers.

- **Audio is never stored**, not by the voice server, not by the API, not in traces. It is
  turned into text in memory and dropped.
- **Captions are not stored.** They are shown live in your tab only.
- What is stored is what a typed chat stores: each finished spoken question (as the speech to
  text heard it) and its answer, saved into your conversation with the channel `voice`, under
  the same 30-day retention. The voice server asks the API exactly as the chat does.
- The voice server keeps, in its memory only: your IP address and how many calls it started
  today (for the per-address limit; forgotten when the server restarts or the day ends), and
  for each call its id, its conversation id, its state and why it ended, for one hour, so your
  browser can read how the call ended.
- Per-turn timings (how long each step took, no text) go to the operator's Langfuse project.
- The microphone is used only during a call; the browser shows its own indicator while it is.

## What the server keeps

| What | Where | How long |
|---|---|---|
| Your IP address and request counts, for rate limits | the API's memory only, never written to disk | until the process restarts; addresses from past days are dropped once more than 10,000 are held |
| API logs | the default deploy: the API app's logs on Modal; the AWS deploy: Uvicorn access logs (client address, path, status code, time) in CloudWatch | Modal's log retention; 14 days on AWS (the log group retention) |
| Saved conversations: your questions, the answers with their sources, and your votes (see below) | the API's Postgres database (Neon on the default deploy) | deleted 30 days after the conversation was last used; at once when you press "New chat" |
| Voice calls: your IP address and call count for the day, each call's state and end reason (no audio, no captions; see Voice mode) | the voice server's memory only | the day (counts) and one hour (calls), or until the server restarts |
| Traces (see below) | the operator's Langfuse project (Langfuse Cloud, US region, on the default deploy) | the retention set in that project |

On AWS, behind the load balancer, the client address in the API's access logs is usually the
load balancer's own address. Load balancer access logs are not turned on.

## Saved conversations

So that a reload does not lose your chat, the API saves each finished question and answer:

- the question as you typed it and the answer as you saw it (a refusal included), the answer's
  sources, and whether it was typed or spoken (`text` or `voice`),
- a thumbs-up or thumbs-down on an answer, if you give one, and the optional reason you type
  after a thumbs-down (at most 300 characters).

A conversation is keyed by a random id (a UUIDv4) that the server makes and only your browser
keeps. There are no accounts and no list of conversations: the database never stores your IP
address or the session id with them. One link exists outside the database: the API's access
logs (see the table) record the request path, which for the conversation routes contains the
conversation id, next to the client address. Anyone who has the
id can read that conversation, so do not share it, and do not type personal details you would
not want stored.

A conversation is deleted, with its votes, 30 days after its last question
(`CONVERSATION_RETENTION_DAYS`), and at once when you press "New chat". Answers that fail or
that you stop are not saved. An operator can turn saving off (`CONVERSATIONS=0`); the chat then
keeps the conversation in your tab only, as before.

Apart from saved conversations, the database holds only the lessons.

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
