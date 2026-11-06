# ADR 0018: Saved conversations and a framework-free chat engine

Status: accepted.

## Context

Until now the chat lived only in the browser tab. A reload lost the conversation, follow-ups
worked because the page sent its last six turns with every question, and there was no way for a
reader to say an answer was wrong. The streaming code was one function inside the React page, so
it could not be tested without a browser, and a voice mode (planned next) would have had to copy
it.

Two constraints shape the change:

- **Vercel deploys the site on every push, the owner redeploys Modal by hand.** For a while the
  new site talks to the old API (no conversation routes). The site must work against both.
- **No accounts.** Readers do not sign in, so a saved conversation needs a key that only their
  browser knows.

## Decision

**Server-side conversations** (`conversations.py`, tables created by `migrate`):

- `conversations` (UUIDv4 id from `gen_random_uuid()`, created and last-active times),
  `messages` (role, text, sources and outcome fields for answers, channel `text` or `voice`)
  and `feedback` (one vote per answer, up or down, with an optional short reason). Deleting a
  conversation deletes its messages and votes.
- Routes: `POST /conversations`, `GET /conversations/{id}` (messages oldest first, with votes),
  `DELETE /conversations/{id}`, `POST /conversations/{id}/messages/{message_id}/feedback`
  (`{"vote": "up" | "down" | null, "reason"?}`; null clears; the latest call wins). Ids must be
  canonical lowercase UUIDv4 (anything else is 422); an unknown id is 404. A vote is accepted
  only on an answer of the same conversation.
- `/ask` takes an optional `conversation_id` (and `channel`). With it, the server loads the last
  six finished turns itself and ignores any `history` the client sent, so a client can no longer
  forge earlier turns. Turns the guard refused are skipped, as the client already did.
- **What is saved, and when:** the question and the answer are saved together when the stream
  ends with `done`. That includes refusals (not in the lessons, a guard block, an answer
  withdrawn by the output check, saved as the withdrawal message), because a restored chat
  should look the way it did. An answer that ends with an error, a stopped answer and a client
  that leaves mid-answer save nothing: the reader never saw a finished turn. The `done` event
  then carries `message_id`. Every `done` also carries `text`, the full answer, which the
  client treats as the truth over the streamed pieces.
- **Retention:** conversations idle for 30 days are deleted. `POST /conversations` runs the
  prune at most once an hour per API process (one indexed `DELETE`). We chose this over a
  Modal scheduled function: it needs no extra deploy, costs nothing while nobody uses the site
  (an idle site creates no conversations, and an idle conversation cannot be read by anyone but
  its holder anyway), and is covered by the same tests as the routes.
- **Limits:** the conversation routes have their own per-IP limiter (30 a minute, 1,000 a day)
  so votes and reloads do not eat the question budget, plus a site-wide cap of 5,000 new
  conversations a day. `/ask` keeps every existing limit; an unknown conversation is a 404 before
  an answer slot is taken. `CONVERSATIONS=0` turns the feature off (routes 404, `/config` says
  so).
- **Feature detection:** `GET /config` gains `features: {conversations, feedback}`. A database
  that is down or not migrated answers 503, so the site falls back instead of breaking.

**The chat engine** (`web/lib/chat/`, no React imports):

- `events.ts` parses each SSE frame into ok, unknown or invalid. Unknown and malformed events
  are skipped, never fatal, so the API can add events without breaking deployed pages.
- `reducer.ts` turns actions (sent, event, failed, resend, restore, vote) into rows (question,
  answer with a live flag, error card) and a turn status (idle, thinking, streaming). An answer
  that closes empty is dropped and replaced by a card; a failure keeps any partial text, marked
  cut. Each finished answer is announced once.
- `recovery.ts` maps a failure kind to an action: wait and resend on a cold start (503, Retry-After
  between 3 and 15 s), wait out a short 429, resend after a network failure or a stall, resend in
  a new conversation when the saved one is gone (404). Each automatic recovery runs at most once
  per question; everything else shows a card with Retry.
- `transport.ts` defines the transport interface. The live transport posts `/ask`, gives up
  after 30 s without headers, and runs a stall timer that restarts on every received byte: 45 s
  once the answer streams, 150 s before the first token (a cold GPU is legitimately silent for up
  to 90 s after a rewrite and an embedding, and Modal ends any request at 150 s anyway).
- `replay.ts` is a second transport that plays event streams recorded from a local run, with
  their timing and a speed factor. Tests drive the whole controller through it, and
  `/ask?demo=1` uses it (labelled as a recorded demo) to show the chat while the API sleeps.
- `controller.ts` ties them together and decides the mode from `/config`: saved conversations
  (the id lives in `localStorage` under `cairnly.conversation.v1`, the conversation is restored
  on load, the server keeps the history) or, when the feature is missing or `/config` fails,
  history in the tab exactly as before. A question waits up to 4 s for `/config`, so the first
  question already uses the right mode; once a question went out with tab history the page stays
  in that mode.

**The page** renders the rows: answers typed out with `requestAnimationFrame` (about 80
characters a second plus speed for the backlog, at most about 30 React commits a second, never
for history, the full text under reduced motion), auto-scroll that follows only while the reader
is at the end of the chat, a transcript that is a non-live log with one polite status region,
and thumbs up and down that are optimistic and roll back on failure.

## Consequences

- The site can ship before the API: an old API simply has no `features`, and the chat behaves as
  it did. The API needs `migrate` (Modal: `modal run deploy/modal_api.py::migrate`) before the
  new routes work; until then they answer 503 and the chat falls back.
- The database now holds what readers typed. PRIVACY.md lists it with its retention. The id in
  the browser is the only key: anyone who has it can read that conversation, so it never goes in
  a URL, and "New chat" deletes the old conversation on the server.
- Votes are stored but not yet forwarded to Langfuse: an answer's trace id is not kept with the
  message. Adding it later is a column and one SDK call.
- Retrying an older failed question saves it after the newer turns, so a restored chat shows it
  in save order. Rare enough to accept.
- Two tabs on one browser share the stored conversation and both write to it.
- Voice (planned) reuses the same routes with `channel: "voice"` and the same rows.
