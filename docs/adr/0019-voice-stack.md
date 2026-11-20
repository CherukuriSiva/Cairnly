# ADR 0019: Voice mode and its stack

Status: accepted.

## Context

Readers asked to talk to the chat. A voice turn has more steps than a text turn: notice that
the caller has finished, turn the speech into text, answer, and turn the answer into speech,
all while the caller waits in silence. Three constraints shape it:

- **One answer flow.** The guard, the limits, the confidence gate, the citations and the saved
  conversation already exist for text (ADR 0014, 0016, 0018). Voice must not grow a second copy.
- **Free-tier spend.** The site runs on Modal with a spend limit (ADR 0017). Speech models on a
  GPU cost money for every minute a container is up.
- **Ship the site before the server.** Vercel deploys on every push; the owner deploys Modal by
  hand. The site must work with no voice server at all.

## Decision

**A separate voice server** (`src/cairnly/voice/`, `cairnly voice-serve` locally, the Modal
app `cairnly-voice` in production) runs one [Pipecat](https://github.com/pipecat-ai/pipecat)
1.15.0 pipeline (BSD-2) per call:

```
caller audio -> [half-duplex gate] -> Silero VAD -> Whisper large-v3-turbo -> brain
             -> Kokoro-82M -> caller
```

- **Silero VAD** (ONNX, bundled with Pipecat): speech starts after 0.2 s of voice, a turn ends
  after 0.7 s of silence.
- **Whisper large-v3-turbo** through faster-whisper (CTranslate2): float16 on a T4 in
  production, int8 on the CPU locally (12 threads cut a 4 s question from 3.8 s to 1.6 s on the
  benchmark laptop). The course's words go in as `hotwords`, with faster-whisper's own VAD on
  (see the addendum). Pipecat's own Whisper service insists on mlx-whisper on Apple silicon, so
  `models.WhisperSTT` wraps faster-whisper directly; the model is loaded once per process.
- **Kokoro-82M** through kokoro-onnx on the CPU (voice `af_heart`), shared by all calls.
- **The brain** (`flow.CallBrain`) runs no model. Each finished turn goes to the API's `/ask`
  with the conversation id and `channel: "voice"`, so every protection and the saving of both
  messages are the text chat's own. As soon as the turn is final it says a holding line ("Let
  me check the lessons."), then speaks the answer sentence by sentence as tokens stream
  (`speech.SpeechChunker`: no markdown, code blocks, tables, URLs or `[n]` markers; one line
  says there is a code example). Refusals, a withdrawn answer and API errors (429, 503, a
  deleted conversation) are spoken as plain sentences.
- **Barge-in:** the caller's speech while the bot talks or looks up an answer stops the answer
  and every queued sentence (a Pipecat interruption); the WebSocket also tells the browser to
  drop the audio it has queued. `VOICE_HALF_DUPLEX=1` instead replaces the caller's audio with
  silence while the bot speaks. The browser asks for echo cancellation and plays the bot through
  an `<audio>` element, the path its echo canceller listens to. A transcript that is mostly the
  bot's own recent words is dropped as its echo, and while the bot is audible it is the
  caller's transcribed words, not their voice alone, that stop it (addendum).
- **Call control** (`calls.py`, plain Python, tested with a fake clock): `GET /voice/status`,
  an idempotent `POST /voice/calls` (the same browser key never opens a second call; a new call
  on the same conversation replaces the old one), one call at a time, a 5-minute limit with a
  notice 30 s before, a hang-up after 50 s of silence or on a spoken goodbye, and an end reason
  per call (farewell, idle, max_duration, hung_up, replaced, error) readable for an hour.
  Budgets per UTC day: 10 calls per address and **60 voice minutes for the whole site**; a call
  never gets more time than the budget has left, and once it is spent a start is refused and
  the microphone disappears after that click. A call has exactly one socket: the token is
  checked and the call claimed in one step before the socket is accepted, and a socket without
  the site's `Origin` is refused. A start that never connects frees its place after 10 s.
- **Events** to the browser (`protocol.py`): `call.ready`, `caption.user`, `caption.bot`
  (marked when it is the holding line), `turn.saved`, `call.ending`, `call.closed` and, on the
  WebSocket, `audio.clear`. A bot caption is queued with the audio, so it reaches the browser
  as its sentence starts playing.
- **Timings** per turn (no text) go to the log and to Langfuse: end of speech to transcript,
  transcript to first answer token, first token to first answer audio, and the total.

**The browser** (`web/lib/voice/`, no React): a pure state machine (idle, connecting, greeting,
listening, thinking, speaking, ended, failed) fed by server events, audio levels every 100 ms
(the bot counts as speaking above RMS 0.02, held 1.2 s) and a one-second clock against an
absolute deadline; a controller that starts the call inside the click (the audio context is
resumed and the audio element unlocked before anything is awaited, for iOS), retries once while
the last call is still closing, hangs up gracefully and then reloads the conversation, so the
spoken turns appear as normal messages; and an adapter interface with WebSocket and WebRTC
implementations. The mic shows when the site was built with `NEXT_PUBLIC_VOICE_URL` and the
API has saved conversations; **loading `/ask` sends nothing to the voice server.** The first
click asks for its status (once per page, not again after each call) and starts the call,
showing "Waking the voice model…" with the seconds it takes; a refusal (off, busy, a limit, the
minutes spent) or a server that cannot be reached hides the mic with one neutral line, "Voice
isn't available right now.", for a minute (addendum).

### Transport: WebSocket in production, WebRTC locally

The plan was Pipecat's peer-to-peer WebRTC (SmallWebRTC, STUN, the SDP offer posted over HTTPS).
The question was whether a Modal container can receive the caller's UDP media without a TURN
relay. What Modal and Pipecat document (checked November 2026):

- Modal's tunnels expose **TCP** ports only; inbound UDP is not documented
  ([modal.com/docs/guide/tunnels](https://modal.com/docs/guide/tunnels)).
- Modal's own WebRTC example runs SmallWebRTC with STUN and says it "works on many networks",
  but that TURN is "necessary if you want to use WebRTC across complex (e.g. carrier-grade) NAT
  or firewall configurations", offers a free public TURN relay as an option, and recommends a
  managed provider "for production or stubborn NATs"
  ([modal.com/docs/examples/webrtc_yolo](https://modal.com/docs/examples/webrtc_yolo)).
- Pipecat's SmallWebRTC docs: "For production deployments across different networks, you may
  need to configure STUN/TURN servers"
  ([docs.pipecat.ai](https://docs.pipecat.ai/server/services/transport/small-webrtc)); Pipecat's
  Modal deployment example uses Daily, a paid service.
- Modal web endpoints do support WebSockets (one function call per connection, messages up to
  2 MiB, bounded by the function timeout) ([modal.com/docs/guide/webhooks](https://modal.com/docs/guide/webhooks)).

So the docs do **not** show peer-to-peer WebRTC working for every caller on Modal without a
TURN service, and phones on carrier-grade NAT are exactly the callers a public demo gets. The
**production transport is Pipecat's WebSocket transport over WSS**: 16 kHz PCM up, 24 kHz PCM
down, JSON events as text frames, on the same HTTPS endpoint as the routes. The socket needs a
one-time token from the start route and an allowed origin. SmallWebRTC stays for local use
(`VOICE_TRANSPORTS=websocket,webrtc` locally, `?transport=webrtc` on `/ask`), behind the same
browser adapter, so a TURN service later is a settings change, not a rewrite. The WebSocket
costs a little latency (TCP head-of-line blocking, no jitter buffer of its own) that a short
playback lead (60 ms) covers on a good connection. Not verified: a call to a deployed Modal app.

## Benchmark

`evals/voice_bench.py` (dependency group `voice-bench`; run it with the voice extras). The
audio is **synthetic**: 40 short chat-style questions, each spoken by one of ten text-to-speech
voices (Kokoro US and UK, and the macOS `say` voices for US, UK, Australian, Irish, Indian and
South African English), generated on every run and never saved. Synthetic speech is cleaner
than a real microphone, so the error rates are a floor, useful only to compare engines.
Hardware: Apple M5 Max, 18 cores, 36 GB RAM, macOS, everything on the CPU.

| Speech to text (40 clips, 88 s of audio) | WER | Real-time factor | Median per question | Exact |
|---|---|---|---|---|
| Whisper large-v3-turbo (faster-whisper, int8, 12 threads) | **1.5%** | 0.794 | 1,754 ms | 37/40 |
| Parakeet-TDT 0.6B v2 (ONNX via onnx-asr, int8) | 2.7% | **0.016** | **34 ms** | 36/40 |

Errors: both heard "LoRA" as "law of" (Australian voice); Whisper heard "reranker" as
"Raranka" and "models" as "modules"; Parakeet spelled "RAG" as "R A G" and heard "reranker" as
"ranker". Parakeet ran on this Mac through onnx-asr (no NeMo, no GPU), so distil-large-v3 was not
needed as the alternative.

| Text to speech (10 answer sentences) | First audio (median) | Real-time factor |
|---|---|---|
| Kokoro-82M (kokoro-onnx, CPU) | 507 ms | 0.113 |
| Piper en_US-lessac-medium (ONNX, CPU) | **48 ms** | **0.011** |

**Local end to end** (this laptop, `cairnly serve` with qwen3:8b on Ollama, the local
Postgres, `cairnly voice-serve` with the real models, CPU speech to text). Server-side timings of
12 turns from headless-Chromium calls with a fake microphone fed a WAV:

| Stage | Median | Range |
|---|---|---|
| VAD stop to transcript (after the 0.7 s silence wait) | 1,745 ms | 1,721 to 1,866 |
| Transcript to first answer token (the API: guard, search, qwen3:8b; no reranker installed locally) | 744 ms | 102 to 2,069 |
| First token to first answer audio (first full sentence, then Kokoro) | 1,960 ms | 930 to 2,182 |
| Holding line's first audio after the VAD stop | 1,955 ms | 1,928 to 2,096 |
| VAD stop to first answer audio | **4,003 ms** | 3,639 to 5,868 |

Seen from the client (`voice_bench.py --e2e`, 5 turns, from the last byte of speech sent):
transcript caption 2.43 s, holding line audio 2.64 s, answer caption 4.04 s, answer audio
4.63 s. The short first-token times are Ollama reusing its cache for a repeated prompt.

**What we keep:** Whisper large-v3-turbo and Kokoro, as planned. Whisper is the more accurate
here and the GPU makes its speed a non-issue in production; Kokoro sounds clearly more natural
than Piper, and its half second to first audio is hidden behind the holding line. Piper stays a
fallback if the CPU ever becomes the bottleneck. **Worth a follow-up:** Parakeet on the CPU is
50 times faster than CPU Whisper at a slightly higher error rate; with it the voice app would
need no GPU at all, which would cut the cost of every wake-up (see below).

## Consequences

- Voice needs saved conversations; against an API without them (today's production) the mic
  never appears. The site ships safely before either Modal app is redeployed.
- **Only a click on the mic wakes the GPU.** Every route of the voice app, `/voice/status`
  included, runs in the GPU container, and any request starts a T4 for about two minutes
  (`scaledown_window` 120 s). A first version asked the status on every `/ask` load, so steady
  visits alone could keep the T4 warm (about $18-20 a day); the page now asks nothing until the
  reader clicks. The price: the first call after a quiet spell waits for a cold start (up to
  about a minute, shown with a seconds counter), and since the status is not re-asked after a
  call, the mic can show while the day's minutes are spent; that click then gets the neutral
  line. A CPU-only status function reading the budget from a shared store, or Parakeet on the
  CPU, would remove the wait.
- **Logs carry no speech.** Pipecat logs through loguru at DEBUG by default, and its DEBUG
  lines quote what the bot says. The voice server replaces that handler at import with one at
  INFO that also drops the few higher lines that quote speech, so captions stay unstored.
- All voice questions reach the API from the voice server's address, so they share one per-IP
  bucket there (10 a minute, 200 a day): a second, site-wide cap on spoken questions. The voice
  server's own per-address call limit is what is per caller.
- Audio is never stored; captions are not stored. Only the saved messages are, as for text
  (PRIVACY.md).
- Pipecat 1.15.0 pins protobuf below 7, so the lock moved protobuf from 7.36.2 to 6.33.6 for
  every install.
- Calls, budgets and end reasons live in one process's memory, like the API's limits (ADR
  0014): a restart forgets them, and a second container would double them.

## Addendum, 2026-11-21: transcripts, echo, hang-up, refusals

**Whisper wrote its hint into transcripts.** A caller's question came back as "A question about
AI engineering. What is? RAG RAG, LLMs, embeddings, vector search, evals. RAG, LLMs, ...". The
hint went in as `initial_prompt`, which Whisper treats as text said just before; on a pause, a
quiet start or no speech at all it carries on writing it. Reproduced locally (faster-whisper
1.2.1, large-v3-turbo int8, `say` voices plus silence and noise): 1.5 s of silence gave "RAG,
LLMs, embeddings, vector search, evals." and 2 s of faint noise "RG, LLMs, embeddings, vector
search, VIR, LLMs, findings, vector search, evals.", both with `no_speech_prob` 0.00, so the
existing no-speech filter (0.6) never fired: turbo's no-speech estimate is useless here. Tried
on the same clips: the hint as `hotwords` (faster-whisper puts it in the prompt slot without
the sentence) did not echo it, but on silence still made up "Thank you" after 7.5 s of
temperature fallbacks; `vad_filter=True` (faster-whisper's bundled Silero) returned nothing for
silence and noise in 3 ms and transcribed every spoken test question as before (1.5 s of
leading silence, a 1.2 s pause mid-question, speech at 5% volume, "Why?"). **Decision:** `hotwords`
("RAG, LLM, LoRA, embeddings, vector search, evals"; LoRA now comes out as "LoRA", not "Laura"),
`vad_filter=True`, the no-speech filter kept, and `speech.drop_hint_echo` on every transcript:
it removes the old prompt sentence and any run of three or more hint terms with only
punctuation between them, keeping a single term in such a run that breaks the hint's order (the
caller's own "RAG" in "RAG RAG, LLMs, ..."). One or two terms ("RAG or LLMs?") are always kept;
a two-term leak would get through. The benchmark uses the same function.

**Echo and barge-in.** How barge-in worked (Pipecat 1.15.0, checked in the installed package):
`VADProcessor` only emits `VADUserStartedSpeakingFrame`/`VADUserStoppedSpeakingFrame`; the
transport has no VAD of its own here, and the pipeline has no LLM user aggregator, so no
Pipecat turn strategy interrupts anything. `CallBrain` itself called `broadcast_interruption()`
on the VAD's start frame whenever the bot spoke or an answer was on its way, before any
transcript existed. With full duplex on laptop speakers, the bot's own voice in the microphone
therefore cut the bot off, and its transcript was then asked as a question. A transcript check
alone could not stop the cut. Pipecat 1.15 does have turn-start strategies
(`TranscriptionUserTurnStartStrategy`, `MinWordsUserTurnStartStrategy`, with
`enable_interruptions`), but they run inside `UserTurnProcessor` / the LLM user aggregator,
which would also take over ending the turn, and none compares the words with what the bot said.
**Decision**, in `CallBrain`: it keeps what the bot said (greeting, holding line, answer
sentences, with times) for 60 s. Speech that starts while the bot is audible (speaking, or
stopped less than 1.5 s ago) no longer interrupts on the VAD; when its transcript arrives it is
dropped as echo if at least 70% of its words are, in order, the bot's recent words (longest
common subsequence), with a fixed log line and no text; otherwise the caller takes the floor:
the bot is interrupted then and the words become the question. With the bot silent (an answer
being looked up), the VAD interrupts at once as before. The greeting check of the first 12 s
stays. **Trade-off:** over the bot, an interruption now lands when the caller pauses (0.7 s of
silence) plus speech-to-text time (1.7 s on the laptop CPU; less on the T4, not measured),
instead of 0.2 s after they start; the bot talks over them meanwhile. And with strong echo the
VAD may hear one long segment of bot-plus-caller; if the bot's words are 70% of it, the
caller's few words are dropped with it. Half duplex is unchanged (the gate means the VAD hears
nothing while the bot speaks).

**Hang-up.** The server released a call's place and stopped counting its minutes only once the
pipeline had finished closing, and the browser closed its socket 500 ms after sending the
hang-up whatever the server did. Now `CallBook.hang_up` charges the minutes up to the hang-up and
frees the place the moment it arrives (the socket's `call.hangup`, the end route, or a browser
that went away); the session then closes behind it. The browser silences the bot first
(`VoiceLink.stopAudio`: queued buffers stopped, audio still arriving dropped, the `<audio>`
element muted until the next call), sends the hang-up, and waits up to 2 s, never longer, for
`call.closed` or the server's close.

**Refusals.** A refusal hid the mic until a reload. It now hides it with the same neutral line
for 60 s; then the mic comes back with nothing sent, and its next click asks the status again.
A hang-up while connecting never hides it. The cost: someone who clicks once a minute after
refusals asks `/voice/status` each time, which wakes the GPU if it slept; only a click does.
