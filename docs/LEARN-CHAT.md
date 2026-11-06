# Learn: a chat that survives reloads, cold starts and an older server

M4 made the chat safe to leave running. This step makes it feel solid: a reload keeps the
conversation, readers can say an answer was wrong, answers appear smoothly, and the chat
recovers from a sleeping server by itself. It also moves the chat logic out of React into a
small engine that a voice mode can reuse. Design record: [ADR 0018](adr/0018-saved-conversations-and-chat-engine.md).

## 1. Where does a conversation live? (`conversations.py`, `db.py`)

Before, the browser tab held the conversation and sent the last six turns with every question.
That is simple, but a reload loses everything, and the server has to trust history the client
made up (an attacker can write a fake "earlier answer").

Now three tables hold it: `conversations`, `messages` and `feedback`. The interesting parts:

- **The key is a random UUIDv4** made by Postgres (`gen_random_uuid()`), 122 random bits. There
  are no accounts, so the id is the only key: whoever has it can read the conversation. That is
  why it stays in the browser's `localStorage`, never in a URL, and why the API has no route
  that lists conversations.
- **Strict ids.** The routes accept only the canonical lowercase UUIDv4 form; anything else is
  a 422 before the database is asked. An unknown id is a 404.
- **When is a turn saved?** When the answer stream ends with `done`, the question and the answer
  are saved together in one transaction. A refusal is saved too (it is what the reader saw); an
  error, a stopped answer or a closed tab saves nothing. The `done` event then carries the saved
  answer's `message_id`, which the vote buttons need.
- **The server keeps the history.** With a conversation id, `/ask` reads the last six finished
  turns from the database and ignores any history the client sent. Turns the guard refused are
  left out, so one blocked attack does not block every follow-up.
- **Retention without a scheduler.** Conversations idle for 30 days are deleted. Instead of a
  cron job, `POST /conversations` runs one indexed `DELETE` at most once an hour. An idle site
  creates no conversations, so it also prunes nothing, and that is fine: nobody can reach an old
  conversation without its id.

Try it: `curl -s -X POST localhost:8010/conversations` returns an id; ask with
`{"question": "What is RAG?", "conversation_id": "<id>"}`; `curl localhost:8010/conversations/<id>`
shows both messages.

## 2. Shipping a site before its server (`GET /config`)

Vercel deploys the site on every push; the API on Modal is redeployed by hand, later. For a
while the new site talks to the old API. The rule: **feature-detect, never assume.**

`GET /config` now says `features: {conversations: true, feedback: true}`. The old API has no
`features`, so the chat keeps the conversation in the tab and shows no vote buttons, exactly as
before. The same happens when `/config` fails, when creating a conversation fails (the database
is down, or the new tables were not migrated yet: the API answers 503), and in the demo.

Two details make the switch safe. A question waits up to 15 seconds for `/config` (a slow
`/config` means the API is waking up, and `/ask` would be just as slow), so the first question
already goes out in the right mode. And once a question went out with tab history, the page
stays in that mode: switching halfway would lose the earlier turns.

## 3. A chat engine without React (`web/lib/chat/`)

The streaming code used to live inside the page component. Now it is plain TypeScript that runs
in Node tests, in four small parts:

- **Parser** (`events.ts`): each SSE frame becomes `ok`, `unknown` or `invalid`. Unknown event
  types are skipped, never fatal, so the API can add events without breaking pages that are
  already deployed. This is the same idea as "be liberal in what you accept".
- **Reducer** (`reducer.ts`): a pure function from actions (sent, an event arrived, failed,
  retry, restore, vote) to rows (the question, the answer with a `live` flag, an error card) and
  a status (idle, thinking, streaming). Pure means a test can feed it events and compare rows,
  with no timers or network. Two rules worth copying: the `done` event's full text wins over the
  streamed pieces (a lost token cannot stay wrong), and an answer that closes empty is dropped
  and replaced by a card instead of leaving an empty bubble.
- **Recovery table** (`recovery.ts`): one function maps each failure kind to an action. A cold
  start (503) waits and asks again; a short rate limit (429 with Retry-After of 10 s or less) is
  waited out; a network failure or a stall asks again; a deleted conversation (404) starts a new
  one and asks again. Each of these runs **at most once per question**, so a broken server
  cannot cause a retry storm. Everything else shows a card with Retry.
- **Transports** (`transport.ts`, `replay.ts`): an interface with `send(body, onData, signal)`.
  The live transport talks to `/ask`. The replay transport plays event streams that were
  recorded from a real local run, with their real timing and a speed factor.

`controller.ts` ties them together and is what the page subscribes to (React's
`useSyncExternalStore`).

## 4. Detecting a dead stream: the stall timer

A stream can die silently: a proxy drops the connection and no error ever arrives. The live
transport starts a timer that restarts on **every received byte**. Once the answer is streaming,
45 seconds of silence counts as a stall: the transport cancels the read and the recovery table
asks again once.

Before the first token the server is allowed to be quiet for much longer: a cold GPU loads the
model (the API waits up to 90 s for the first token, after a follow-up rewrite and an
embedding). Modal ends every web request after 150 s, so that is the limit before the answer
starts. Without this split, the stall timer would cut every cold start.

## 5. Recorded streams for tests and demos (`replay.ts`, `recordings.ts`)

Mocking the network in every test is tedious and drifts from reality. Instead, we recorded five
real streams once and play them back: a cited answer, a not-in-the-lessons refusal, a guard
block, a slow cold start (a 503 first, then a long wait for the first token) and an error in the
middle of an answer that succeeds on Retry. Tests run them with fake timers in milliseconds.

The same transport powers `/ask?demo=1`, so the chat can be shown in an interview while the
backend sleeps. It is labelled "Recorded demo" and never calls the API.

## 6. Answers that read smoothly (`reveal.ts`, `useReveal.ts`)

Tokens arrive in bursts. Showing each burst as it lands looks jumpy. A typewriter smooths it:

- Every animation frame (`requestAnimationFrame`) shows a few more characters. The speed is
  `80 + backlog / 0.8` characters a second: about 80 when little is waiting, faster as the
  backlog grows, so a long answer catches up within about 3 seconds.
- React re-renders at most about 30 times a second, not once per frame.
- History is never animated (a restored chat appears at once), and under "reduce motion" the
  text shows as it arrives.

## 7. Scrolling and screen readers (`follow.ts`, `useFollow.ts`)

**Auto-scroll** follows new text only while you are at the end of the chat. Scrolling up (mouse
wheel, touch, Page Up, the scrollbar) stops it at once; scrolling back to the end turns it on
again; sending a question jumps to the end. It keeps the end of the chat at the bottom of the
window, not the end of the page, so the footer stays out of the way.

**Screen readers** should not hear every token. The transcript is a `role="log"` with
`aria-live="off"`, and one separate polite status region announces each finished answer once
(as plain text, without markdown or `[n]` markers), the waking note, and errors.

## 8. Feedback (`Feedback.tsx`)

Each saved answer has thumbs up and down (`aria-pressed`). A click shows at once (optimistic)
and is undone if the API refuses it; clicking the pressed thumb clears the vote; the latest vote
wins on the server. Thumbs down opens an optional "what was wrong" box: focus moves into it and
Escape closes it and returns focus to the thumb. Votes come back after a reload.

## Try it

```bash
uv run cairnly migrate                      # creates the conversation tables (safe to re-run)
uv run pytest tests/test_conversations.py   # the SQL and the routes (needs the Compose db)
uv run cairnly serve
curl -s localhost:8010/config               # ..."features": {"conversations": true, ...}
cd web && npm test && npm run dev           # http://localhost:3010/ask, then reload the page
open "http://localhost:3010/ask?demo=1"     # recorded demo, no API needed
```
