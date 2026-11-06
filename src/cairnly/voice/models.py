"""The speech services a call uses: real models, or fakes for tests and UI work.

Real: Silero VAD (bundled with Pipecat), Whisper large-v3-turbo through faster-whisper (CPU
int8 locally, the GPU in production) and Kokoro-82M through kokoro-onnx (CPU). Each model is
loaded once per process and shared by every call; a call only builds thin Pipecat services
around them.

Fake (`VOICE_FAKE_MODELS=1`, and the tests): an energy VAD (anything loud is speech), a
speech-to-text that returns scripted questions, and a text-to-speech that plays a soft tone as
long as the text would take to say. No model files, no GPU.
"""

import asyncio
import math
import os
import threading
from collections.abc import AsyncGenerator, Callable, Iterable
from dataclasses import dataclass

import numpy as np
from pipecat.audio.vad.vad_analyzer import VADAnalyzer, VADParams
from pipecat.frames.frames import ErrorFrame, Frame, TranscriptionFrame, TTSAudioRawFrame
from pipecat.services.settings import STTSettings, TTSSettings
from pipecat.services.stt_service import SegmentedSTTService, STTService
from pipecat.services.tts_service import TTSService
from pipecat.transcriptions.language import Language
from pipecat.utils.time import time_now_iso8601

from cairnly.voice.protocol import IN_RATE, OUT_RATE
from cairnly.voice.settings import VoiceSettings

# Speech start needs 0.2 s of voice; the turn ends after 0.7 s of silence. Shorter stops cut
# people off mid-thought, longer ones make every answer feel slow.
VAD = VADParams(confidence=0.7, start_secs=0.2, stop_secs=0.7, min_volume=0.5)
# Steers Whisper towards the course's vocabulary (spelling of RAG, LLM, embeddings...).
STT_PROMPT = "A question about AI engineering: RAG, LLMs, embeddings, vector search, evals."


@dataclass
class SpeechServices:
    """Factories for one call's services."""

    vad: Callable[[], VADAnalyzer]
    stt: Callable[[], STTService]
    tts: Callable[[], TTSService]


# -- real models -------------------------------------------------------------------------

_models: dict[str, object] = {}
_lock = threading.Lock()


def _shared(key: str, load: Callable[[], object]) -> object:
    with _lock:
        if key not in _models:
            _models[key] = load()
        return _models[key]


def whisper_model(settings: VoiceSettings):
    from faster_whisper import WhisperModel

    # faster-whisper's default is 4 CPU threads; more cut a 4 s question from 3.8 s to 1.6 s
    # on a 14-core laptop (ADR 0019). Ignored on the GPU.
    threads = settings.stt_threads or min(12, os.cpu_count() or 4)
    key = f"whisper:{settings.stt_model}:{settings.stt_device}:{settings.stt_compute}"
    return _shared(key, lambda: WhisperModel(settings.stt_model, device=settings.stt_device,
                                             compute_type=settings.stt_compute,
                                             cpu_threads=threads))


def kokoro_model():
    from pipecat.services.kokoro.tts import KOKORO_CACHE_DIR, Kokoro, _ensure_model_files

    def load():
        model, voices = KOKORO_CACHE_DIR / "kokoro-v1.0.onnx", KOKORO_CACHE_DIR / "voices-v1.0.bin"
        _ensure_model_files(model, voices)
        return Kokoro(str(model), str(voices))

    return _shared("kokoro", load)


class WhisperSTT(SegmentedSTTService):
    """Whisper through faster-whisper on one VAD segment at a time, with the shared model.
    (Pipecat's own Whisper service insists on mlx-whisper on Apple silicon; this one runs the
    same faster-whisper code everywhere.)"""

    def __init__(self, model, **kwargs):
        super().__init__(sample_rate=IN_RATE,
                         settings=STTSettings(model=None, language=Language.EN), **kwargs)
        self.model = model

    @property
    def wants_wav_segments(self) -> bool:
        return False

    def can_generate_metrics(self) -> bool:
        return True

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame, None]:
        samples = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768

        def transcribe() -> str:
            segments, _ = self.model.transcribe(samples, language="en", beam_size=1,
                                                initial_prompt=STT_PROMPT)
            return " ".join(s.text.strip() for s in segments if s.no_speech_prob < 0.6)

        await self.start_processing_metrics()
        try:
            text = (await asyncio.to_thread(transcribe)).strip()
        except Exception as exc:
            yield ErrorFrame(error=f"speech to text failed: {exc}")
            return
        finally:
            await self.stop_processing_metrics()
        if text:
            yield TranscriptionFrame(text, "caller", time_now_iso8601(), Language.EN)


def real_services(settings: VoiceSettings) -> SpeechServices:
    """Load the models now (a container loads them before its first call), then hand out
    services that share them."""
    from pipecat.audio.utils import create_stream_resampler
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.services.kokoro.tts import KokoroTTSService

    whisper, kokoro = whisper_model(settings), kokoro_model()

    class SharedKokoro(KokoroTTSService):
        def __init__(self, voice: str):
            # KokoroTTSService.__init__ would load the model again: set it up the same way,
            # with the shared one.
            TTSService.__init__(
                self, push_start_frame=True, push_stop_frames=True,
                settings=self.Settings(model=None, voice=voice, language="en-us", speed=1.0))
            self._kokoro = kokoro
            self._resampler = create_stream_resampler()

    return SpeechServices(
        vad=lambda: SileroVADAnalyzer(params=VAD),
        stt=lambda: WhisperSTT(whisper),
        tts=lambda: SharedKokoro(settings.tts_voice),
    )


# -- fakes -------------------------------------------------------------------------------


class EnergyVAD(VADAnalyzer):
    """Speech is anything louder than a threshold. For tests and fake-model runs."""

    def __init__(self, threshold: float = 0.05, **kwargs):
        super().__init__(params=VADParams(confidence=0.5, start_secs=0.1, stop_secs=0.4,
                                          min_volume=0.0), **kwargs)
        self.threshold = threshold

    def num_frames_required(self) -> int:
        return int((self.sample_rate or IN_RATE) * 0.02)

    def voice_confidence(self, buffer: bytes) -> float:
        samples = np.frombuffer(buffer, dtype=np.int16).astype(np.float32) / 32768
        rms = float(np.sqrt(np.mean(samples**2))) if samples.size else 0.0
        return 1.0 if rms > self.threshold else 0.0


class ScriptedSTT(SegmentedSTTService):
    """Each speech segment "says" the next scripted line (the last one repeats)."""

    def __init__(self, lines: Iterable[str], **kwargs):
        super().__init__(sample_rate=IN_RATE, trailing_silence_secs=0,
                         settings=STTSettings(model=None, language=None), **kwargs)
        self.lines = list(lines) or ["What is retrieval-augmented generation?"]
        self.heard = 0

    @property
    def wants_wav_segments(self) -> bool:
        return False

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame, None]:
        line = self.lines[min(self.heard, len(self.lines) - 1)]
        self.heard += 1
        yield TranscriptionFrame(line, "caller", time_now_iso8601())


class ToneTTS(TTSService):
    """"Speaks" a soft 220 Hz tone, 60 ms per character (about natural speech speed)."""

    def __init__(self, seconds_per_char: float = 0.06, **kwargs):
        super().__init__(push_start_frame=True, push_stop_frames=True, sample_rate=OUT_RATE,
                         settings=TTSSettings(model=None, voice=None, language=None), **kwargs)
        self.seconds_per_char = seconds_per_char

    async def run_tts(self, text: str, context_id: str) -> AsyncGenerator[Frame, None]:
        try:
            seconds = max(0.3, len(text) * self.seconds_per_char)
            t = np.arange(int(OUT_RATE * seconds)) / OUT_RATE
            wave = (0.2 * np.sin(2 * math.pi * 220 * t) * 32767).astype(np.int16).tobytes()
            chunk = OUT_RATE // 10 * 2  # 100 ms
            for start in range(0, len(wave), chunk):
                yield TTSAudioRawFrame(audio=wave[start:start + chunk], sample_rate=OUT_RATE,
                                       num_channels=1, context_id=context_id)
        except Exception as exc:  # a fake should fail the way a real service reports it
            yield ErrorFrame(error=str(exc))


def fake_services(lines: Iterable[str] = (), seconds_per_char: float = 0.06) -> SpeechServices:
    script = list(lines)
    return SpeechServices(vad=EnergyVAD, stt=lambda: ScriptedSTT(script),
                          tts=lambda: ToneTTS(seconds_per_char))


def services_for(settings: VoiceSettings) -> SpeechServices:
    return fake_services() if settings.fake_models else real_services(settings)
