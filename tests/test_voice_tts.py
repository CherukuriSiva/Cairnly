"""Text to speech that is slow to start a sentence (Kokoro on a shared CPU) still counts as
speaking: no "no audio" error, one start and one stop around the sentence."""

import asyncio

import pytest

pytest.importorskip("pipecat")  # the voice extra

from pipecat.frames.frames import (  # noqa: E402
    ErrorFrame,
    TTSAudioRawFrame,
    TTSSpeakFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
)
from pipecat.tests.utils import SleepFrame, run_test  # noqa: E402

from cairnly.voice.models import ToneTTS  # noqa: E402


class SlowStartTone(ToneTTS):
    """Synthesizes the whole sentence before its first chunk, as Kokoro does on a slow CPU."""

    async def run_tts(self, text, context_id):
        await asyncio.sleep(3.5)  # longer than Pipecat's default 3 s wait
        async for frame in super().run_tts(text, context_id):
            yield frame


def test_a_sentence_whose_audio_starts_late_is_not_reported_silent():
    asyncio.run(_a_sentence_whose_audio_starts_late_is_not_reported_silent())


async def _a_sentence_whose_audio_starts_late_is_not_reported_silent():
    tts = SlowStartTone(seconds_per_char=0.002)
    down, up = await run_test(tts, frames_to_send=[
        TTSSpeakFrame("A long sentence that takes a while to synthesize.", append_to_context=False),
        SleepFrame(sleep=4.5),
    ])
    assert not [f for f in up if isinstance(f, ErrorFrame)]
    assert any(isinstance(f, TTSAudioRawFrame) for f in down)
    assert sum(isinstance(f, TTSStartedFrame) for f in down) == 1
    assert sum(isinstance(f, TTSStoppedFrame) for f in down) == 1
