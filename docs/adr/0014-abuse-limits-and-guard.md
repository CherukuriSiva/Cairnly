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
- At most 4 answers are written at once; the 5th gets 503 with Retry-After: 5. The slot is
  released when the stream ends, fails or the client goes away, and also by a background task
  in case the stream never starts.
- The model must send its first token within 90 s (a cold GPU) and finish within 60 s after
  that. Both end in a friendly in-band error; other errors show a generic message, so internal
  URLs never reach the browser.
- **Client IP.** With `TRUST_PROXY=1` (set in production) the client is the LAST entry of
  `X-Forwarded-For`, the one our single proxy appended. Entries to its left come from the
  client and can be forged, so they are never used. Without `TRUST_PROXY` the header is
  ignored.

**Guard** (`guard.py`): named regex rules for injection, jailbreak, prompt extraction and junk,
matching commanding forms rather than topic words, so questions about attacks still pass. It
checks the question, earlier questions and the rewritten follow-up. An output check withdraws
an answer that repeats 8 words in a row from the system prompt and flags answers without
citations.

**Red-team gate**: `evals/redteam.jsonl` (60 attacks, 46 legitimate tricky questions) plus every
golden and off-topic question. CI fails when the false-block rate passes 2% or the miss rate
passes 10%. Measured: 0.0 and 0.0167.

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
- A determined attacker will find phrasings the rules miss. The red-team set grows when one is
  found, and a rule is tightened, never the gate loosened.
- Users behind one shared IP (a university network) share one limit.
- Rules can block a legitimate question. The gate keeps that under 2%, and the chat says
  "Blocked by the safety check" so the reader can rephrase.
