"""Per-turn latency of a voice call, logged and sent to Langfuse (numbers only, never text).

The stages of one turn, each measured from the previous mark:

    speech end -> transcript      speech to text (plus the VAD's end-of-speech wait)
    transcript -> first token     the API: guard, rewrite, search, rerank, first model token
    first token -> first audio    the first answer sentence complete, then synthesised
    speech end -> first audio     the whole wait the caller hears (the holding line covers it)

Also the time to the holding line's audio, which is what the caller hears first.
"""

import logging
import time

from cairnly import tracing

log = logging.getLogger("cairnly.voice")

MARKS = ("speech_end", "transcript", "holding_audio", "first_token", "first_audio", "done")


class TurnTimings:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.at: dict[str, float] = {}
        self.outcome: str | None = None  # answered, refused, interrupted, error
        self.emitted: dict | None = None

    def mark(self, name: str, at: float | None = None) -> None:
        """Record a stage once; later marks of the same stage are ignored."""
        self.at.setdefault(name, self.clock() if at is None else at)

    def _ms(self, start: str, end: str) -> int | None:
        if start in self.at and end in self.at:
            return round((self.at[end] - self.at[start]) * 1000)
        return None

    def report(self) -> dict:
        return {
            "stt_ms": self._ms("speech_end", "transcript"),
            "first_token_ms": self._ms("transcript", "first_token"),
            "tts_first_audio_ms": self._ms("first_token", "first_audio"),
            "holding_audio_ms": self._ms("speech_end", "holding_audio"),
            "total_ms": self._ms("speech_end", "first_audio"),
            "answer_ms": self._ms("transcript", "done"),
        }

    def emit(self, session_id: str) -> dict:
        """Log the turn and trace it, once."""
        if self.emitted is not None:
            return self.emitted
        outcome = self.outcome or "answered"
        report = self.emitted = self.report()
        log.info("voice turn %s %s", outcome,
                 " ".join(f"{k}={v}" for k, v in report.items() if v is not None))
        span = tracing.start_trace("voice-turn", metadata={"outcome": outcome, **report},
                                   tags=["voice"], session_id=session_id)
        span.end()
        return report
