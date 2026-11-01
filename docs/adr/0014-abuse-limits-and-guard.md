# ADR 0014: Abuse limits and a rules-based guard

Status: accepted (M4)

## Context

The API is public through the load balancer, and every answer costs GPU time. Anyone can send
any body and any header. Without limits, one script can run up the Modal bill, crowd out every
other reader, or make the model follow its own instructions instead of ours.

## Decision

**Limits** (`limits.py`, all set by environment variables):

- Per client IP: 10 requests per minute and 200 per day, counting `/ask` and `/search`
  together (both use the GPU). Site-wide: 2,000 answers per day. Over a limit the API answers
  429 with Retry-After. `/config`, `/kbs`, `/health` and `/livez` are not limited.
- Fixed windows per UTC minute and UTC day: simple to explain, test and report ("try again in
  42 seconds"). A refused request is not counted.
- At most 4 answers are written at once; the 5th gets 503 with Retry-After: 5. When the
  response ends, however it ends (finished, failed, client gone, never started), the API closes
  the answer generator itself and then releases the slot. Starlette does not close a sync
  generator on a disconnect, so without this the model stream and the slot were held until
  garbage collection. A test against a real Uvicorn server checks it. The close is not
  instant: a generator cannot be closed in the middle of a step, so it waits for the running
  step to end. While the answer streams, that is the next piece. Before the first event, a
  follow-up's rewrite (up to 90 s) and the query embedding (120 s per read) run as one step,
  so the close can wait about 210 s, or longer if the embedding server sends bytes slowly
  (its limit is per read). Waiting for the first token is a separate step of up to 90 s. The
  slot stays held until then, which is correct, since the model request is still open. No
  extra cancel mechanism: the time limits already bound every step.
- One gap in that count: after a time limit (ModelTooSlow) the answer ends and the slot is
  freed at once, but the reader thread in `llm.time_limited` stops only at the model's next
  piece or at the HTTP read timeout (90 s). For up to 90 s the model request stays open with no
  slot counting it, so a burst of timeouts can briefly put more than 4 requests on the GPU.
- The model must send its first token within 90 s (a cold GPU) and finish within 60 s after
  that, on the wall clock: a reader thread fills a queue and the answer waits on it only for the
  time left. A follow-up's rewrite must finish within 90 s. Timeouts end in a friendly in-band
  error; other errors show a generic message, so internal URLs never reach the browser. The
  worst case before an answer stream ends is about 6 minutes (rewrite 90 s, query embedding
  120 s per read, first token 90 s, answer 60 s); it only happens when every step is slow.
- **Client IP.** With `TRUST_PROXY=1` (set in production) the client is the LAST entry of
  `X-Forwarded-For`, the one our single proxy appended. Entries to its left come from the
  client and can be forged, so they are never used. Without `TRUST_PROXY` the header is
  ignored.

**Guard** (`guard.py`): named regex rules for injection, jailbreak, prompt extraction and junk,
matching commanding forms rather than topic words, so questions about attacks still pass. It
checks the question, earlier questions and the rewritten follow-up. An output check withdraws
an answer that repeats 8 words in a row from the system prompt and flags answers without
citations.

Each rule is built from the same named parts: a **frame** that addresses the assistant (a
sentence start, "can you ...", "you will ...", "I want you to ..."), a **verb**, an **object**
that is the assistant's own rules ("your rules", "all previous instructions", "the system
prompt"), and an **end** that shows the object is finished ("... and tell me a joke", end of
sentence; not "the policy network", "the previous instructions I gave you"). A generic "you"
in a question ("If you override the system prompt, which one wins?") counts only when the
object says "your". A wrong verdict is fixed by narrowing one part, never by listing a string.

**Priorities** (set by the owner after review 3): a learner wrongly blocked is worse than a
missed attack, because the output leak check is a second layer and the confidence gate still
refuses off-topic requests. Following that, style, format and reset requests are allowed
("From now on, reply just in bullet points", and also "From now on, answer as a pirate"): they
change how the answer looks, not what the model may do. Only dropping the rules or the topic
("... ignore your rules", "... answer everything", "... act as an AI with no filters") is
blocked.

**Red-team gate**: `evals/redteam.jsonl`, the tuning set (155 attacks, 178 legitimate tricky
questions, including every probe from the three code reviews), plus every golden and off-topic
question. CI fails when the false-block rate passes 2% or the miss rate passes 10%. Measured on
2026-11-01: 0.0 (0 of 345) and 0.0581 (9 of 155). A held-out set the rules were not tuned on
(`evals/redteam-heldout.jsonl`) is reported next to it, not gated: on all 34 rows, 0 of 15
legitimate questions were blocked and 9 of 19 attacks were missed; on its 22 rows written before
tuning, 0 of 11 and 8 of 11. The rules are a cheap first layer; the output leak check is the
second.

## Why rules and not an ML classifier

A classifier (a fine-tuned BERT or an LLM judge) catches more paraphrases, but it needs a model
server, adds latency to every question, and its mistakes are hard to explain. Rules run in
microseconds, are readable in one file, and their error rates are measured in CI. For a
learning site whose answers are grounded in its own lessons, the damage a missed attack can do
is small: the model still only sees our sources and our prompt, and the output check catches a
prompt leak. A classifier can be added later behind the same `check_input` function.

## Consequences

- The counters live in memory per API task. With `api_max_tasks = 4`, the real caps are up to
  4 times the numbers above, and a restart resets them. A shared store (Redis) would fix that
  but is not worth it for a free demo.
- A determined attacker will find phrasings the rules miss. Every probe a review finds becomes a
  fixed row in the red-team set first, then a rule is narrowed or tightened, never the gate
  loosened. Fixing the newest examples without the old ones had undone earlier fixes three times.
- Users behind one shared IP (a university network) share one limit.
- Rules can block a legitimate question. The gate keeps that under 2% (measured 0 of 345), and
  the chat says "Blocked by the safety check" so the reader can rephrase.
- The rules must stay fast on any input up to the 2,000-character limit. The guard at 1ff8219
  took about four minutes on "ab " followed by 1,990 line breaks, because a sentence start
  allowed two runs of white space in a row; `normalize` now turns every run of white space into
  one character and a test checks such inputs finish in well under a second.
