"""Voice server settings from environment variables (read once, like cairnly.config).

The defaults suit a local run next to `cairnly serve`. The budgets are small on purpose: a call
holds a GPU (speech to text) and the answer model, so the daily minute cap is what keeps the
Modal bill under its spend limit (ADR 0019).
"""

import os
from dataclasses import dataclass
from functools import lru_cache

from cairnly.config import TRUE_WORDS, flag, load_dotenv

TRANSPORTS = ("websocket", "webrtc")
WHISPER_TURBO = "deepdml/faster-whisper-large-v3-turbo-ct2"  # large-v3-turbo for faster-whisper


@dataclass(frozen=True)
class VoiceSettings:
    enabled: bool = True  # VOICE_ENABLED=0: the status route says unavailable
    api_url: str = "http://localhost:8010"  # the cairnly API the brain asks
    transports: tuple[str, ...] = TRANSPORTS  # which ones a call may use; first is the default
    stun_urls: tuple[str, ...] = ("stun:stun.l.google.com:19302",)  # WebRTC only
    max_call_s: int = 300  # a call ends after 5 minutes
    ending_notice_s: int = 30  # "call ending soon" this long before the end
    idle_s: int = 50  # hang up after this long with nobody speaking
    half_duplex: bool = False  # ignore the caller while the bot speaks (no barge-in)
    max_calls: int = 1  # calls at once on this server
    calls_per_ip_per_day: int = 10
    starts_per_ip_per_minute: int = 5  # start requests, retries included
    minutes_per_day: int = 60  # all calls together; starts are refused once spent
    stt_model: str = WHISPER_TURBO
    stt_device: str = "cpu"  # "cuda" on the Modal GPU
    stt_compute: str = "int8"  # "float16" on the GPU
    stt_threads: int = 0  # CPU threads for speech to text; 0: up to 12 of this machine's cores
    tts_voice: str = "af_heart"  # a Kokoro voice
    fake_models: bool = False  # VOICE_FAKE_MODELS=1: scripted speech, for UI work and tests


def _ints(name: str, default: int) -> int:
    return int(os.environ.get(name, str(default)))


def _list(name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return tuple(part.strip() for part in raw.split(",") if part.strip())


def validate(s: VoiceSettings) -> VoiceSettings:
    unknown = [t for t in s.transports if t not in TRANSPORTS]
    if unknown or not s.transports:
        raise ValueError(f"VOICE_TRANSPORTS must list some of {', '.join(TRANSPORTS)}")
    if s.ending_notice_s >= s.max_call_s:
        raise ValueError("VOICE_ENDING_NOTICE_S must be shorter than VOICE_MAX_CALL_S")
    return s


@lru_cache
def get_voice_settings() -> VoiceSettings:
    load_dotenv()
    env = os.environ.get
    return validate(VoiceSettings(
        enabled=env("VOICE_ENABLED", "1").strip().lower() in TRUE_WORDS,
        api_url=env("VOICE_API_URL", "http://localhost:8010").rstrip("/"),
        transports=_list("VOICE_TRANSPORTS", TRANSPORTS),
        stun_urls=_list("VOICE_STUN_URLS", ("stun:stun.l.google.com:19302",)),
        max_call_s=_ints("VOICE_MAX_CALL_S", 300),
        ending_notice_s=_ints("VOICE_ENDING_NOTICE_S", 30),
        idle_s=_ints("VOICE_IDLE_S", 50),
        half_duplex=flag("VOICE_HALF_DUPLEX"),
        max_calls=_ints("VOICE_MAX_CALLS", 1),
        calls_per_ip_per_day=_ints("VOICE_CALLS_PER_IP_PER_DAY", 10),
        starts_per_ip_per_minute=_ints("VOICE_STARTS_PER_IP_PER_MINUTE", 5),
        minutes_per_day=_ints("VOICE_MINUTES_PER_DAY", 60),
        stt_model=env("VOICE_STT_MODEL", WHISPER_TURBO),
        stt_device=env("VOICE_STT_DEVICE", "cpu"),
        stt_compute=env("VOICE_STT_COMPUTE", "int8"),
        stt_threads=_ints("VOICE_STT_THREADS", 0),
        tts_voice=env("VOICE_TTS_VOICE", "af_heart"),
        fake_models=flag("VOICE_FAKE_MODELS"),
    ))
