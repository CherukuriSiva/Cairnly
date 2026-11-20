"""Speech to text without the model: what WhisperSTT asks faster-whisper for, and what it keeps
of the answer. (The real model is checked by hand; ADR 0019 has the transcripts.)"""

from types import SimpleNamespace

import numpy as np
import pytest

pytest.importorskip("pipecat")  # the voice extra

from cairnly.voice import models  # noqa: E402


class FakeWhisper:
    """Answers with fixed segments and records how it was asked."""

    def __init__(self, *segments: tuple[str, float]):
        self.segments = [SimpleNamespace(text=t, no_speech_prob=p) for t, p in segments]
        self.asked: dict = {}

    def transcribe(self, samples, **options):
        self.asked = options
        return iter(self.segments), None


def test_the_hint_goes_in_as_hotwords_with_whispers_own_speech_filter():
    whisper = FakeWhisper((" What is RAG?", 0.01))
    assert models.transcribe(whisper, np.zeros(16000, np.float32)) == "What is RAG?"
    assert whisper.asked["hotwords"] == models.STT_HOTWORDS
    assert "initial_prompt" not in whisper.asked  # the prompt sentence leaked into transcripts
    assert whisper.asked["vad_filter"] is True  # silence and noise never reach Whisper


def test_hint_echo_and_no_speech_segments_are_dropped():
    leaked = FakeWhisper((" What is RAG? RAG, LLM, LoRA, embeddings, vector search, evals.", 0.0),
                         (" When should we use it instead of fine tuning?", 0.1),
                         (" Thank you.", 0.9))
    assert models.transcribe(leaked, np.zeros(16000, np.float32)) == (
        "What is RAG? When should we use it instead of fine tuning?")
    silent = FakeWhisper((" RAG, LLM, LoRA, embeddings, vector search, evals.", 0.0))
    assert models.transcribe(silent, np.zeros(16000, np.float32)) == ""
