"""Voice mode: talk to cairnly and hear the answer.

A separate server (`cairnly voice-serve` locally, the `cairnly-voice` Modal app in production)
runs one Pipecat pipeline per call: the caller's audio, voice activity detection (Silero),
speech to text (Whisper), a "brain" that asks the cairnly API, text to speech (Kokoro) and back
to the caller. The brain runs no model of its own: every question goes through the API's /ask,
so the guard, the limits, the confidence gate, the citations and the saved conversation are the
same as in the text chat (ADR 0019).

Modules without Pipecat (settings, speech, calls, timings) are plain Python, so their tests run
without the voice extra. The rest needs `uv sync --extra voice`; the speech models need
`--extra voice-models`.
"""
