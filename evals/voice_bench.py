"""Voice stack benchmark (ADR 0019): speech to text and text to speech, on this machine.

    uv sync --extra voice --extra voice-models --group voice-bench
    uv run python evals/voice_bench.py                      # STT + TTS, prints a table
    uv run python evals/voice_bench.py --out evals/last-voice.json
    uv run python evals/voice_bench.py --e2e                # + turns through running servers

Speech to text: Whisper large-v3-turbo (faster-whisper, CTranslate2 int8 on the CPU, the
voice server's own settings) against Parakeet-TDT 0.6B v2 (NVIDIA NeMo, ONNX through onnx-asr,
int8 on the CPU), on 40 short questions in the style of the chat. Word error rate (after
lower-casing and dropping punctuation) and real-time factor (seconds of compute per second of
audio).

The audio is SYNTHETIC: each question is spoken by one of several text-to-speech voices with
different accents (Kokoro's US and UK voices, and the macOS `say` voices for British,
Australian, Irish, Indian, South African and US English when `say` exists). It is generated
into a temporary folder on every run and never saved: synthetic speech is cleaner than a real
microphone, so the error rates are a lower bound and are only good for comparing the engines.

Text to speech: Kokoro-82M (ONNX) against Piper (en_US-lessac-medium, ONNX), on ten answer
sentences: time to first audio for one sentence (what the caller waits for) and real-time
factor.

--e2e: five spoken questions through the running stack (`cairnly serve` on 8010 with Ollama,
`cairnly voice-serve` on 8020, both with real models), timed from the end of the caller's
speech as the browser sees it: the transcript caption, the holding line's first audio, the
answer's first caption and its first audio.
"""

import argparse
import asyncio
import json
import os
import platform
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import uuid
import wave
from pathlib import Path

import numpy as np

RATE = 16_000
QUESTIONS = [
    "What is retrieval augmented generation?",
    "When should I use RAG instead of fine tuning?",
    "How do embeddings capture meaning?",
    "What is a vector database used for?",
    "How does hybrid search combine keywords and vectors?",
    "What does a reranker do?",
    "How big should my chunks be?",
    "What is a context window?",
    "Why do tokens matter for cost?",
    "How do I evaluate an LLM app before I ship it?",
    "What is an LLM as a judge?",
    "How do I measure faithfulness?",
    "What is prompt injection?",
    "How do I protect my app from jailbreaks?",
    "What is an AI agent?",
    "When do I actually need an agent?",
    "How does tool calling work?",
    "What is the model context protocol?",
    "How do I stream answers to the browser?",
    "What is temperature in sampling?",
    "Why does my model hallucinate?",
    "How do citations make answers safer?",
    "What is a confidence gate?",
    "How do I trace a slow request?",
    "What should I log for each question?",
    "How do I keep user data private in traces?",
    "What is LoRA fine tuning?",
    "How much data do I need to fine tune?",
    "What is quantization?",
    "Should I run models locally or use an API?",
    "How do rate limits protect a public demo?",
    "What is semantic caching?",
    "How do I rewrite follow up questions?",
    "What is reciprocal rank fusion?",
    "How do I pick an embedding model?",
    "What is a golden evaluation set?",
    "How do I test prompts in continuous integration?",
    "What projects should I build for my portfolio?",
    "How do I explain my project in an interview?",
    "What is the difference between recall and precision?",
]
SENTENCES = [
    "Retrieval-augmented generation finds the relevant lesson text, then answers from it.",
    "Embeddings turn text into vectors, so similar meanings end up close together.",
    "A reranker reads the question and each candidate together, and puts the best ones first.",
    "Keep chunks to one heading section, so each citation opens the right place.",
    "Evaluate with a golden set of questions before every release.",
    "Prompt injection hides instructions inside text the model reads.",
    "An agent is a loop: the model picks a tool, reads the result, and decides what to do next.",
    "Temperature controls how random the next token is.",
    "Trace each request, but keep the user's words out of the traces by default.",
    "Fine-tuning changes how a model writes; retrieval changes what it knows.",
]
KOKORO_VOICES = [("af_heart", "en-us", "Kokoro US female"),
                 ("am_michael", "en-us", "Kokoro US male"),
                 ("bf_emma", "en-gb", "Kokoro UK female"),
                 ("bm_george", "en-gb", "Kokoro UK male")]
SAY_VOICES = [("Samantha", "macOS say, US"), ("Daniel", "macOS say, UK"),
              ("Karen", "macOS say, Australian"), ("Moira", "macOS say, Irish"),
              ("Rishi", "macOS say, Indian"), ("Tessa", "macOS say, South African")]
WHISPER = "deepdml/faster-whisper-large-v3-turbo-ct2"
PARAKEET = "nemo-parakeet-tdt-0.6b-v2"
PIPER_VOICE = "en_US-lessac-medium"


def hardware() -> str:
    cpu = platform.processor() or platform.machine()
    if sys.platform == "darwin":
        cpu = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True,
                             text=True).stdout.strip() or cpu
        ram = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True,
                                 text=True).stdout.strip() or 0) // 2**30
    else:
        ram = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") // 2**30
    return f"{cpu}, {os.cpu_count()} cores, {ram} GB RAM, {platform.system()} {platform.machine()}"


def normalize(text: str) -> str:
    text = text.lower().replace("-", " ").replace("’", "'")
    text = re.sub(r"[^a-z0-9' ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def to_16k(samples: np.ndarray, rate: int) -> np.ndarray:
    import soxr

    return soxr.resample(samples.astype(np.float32), rate, RATE) if rate != RATE else samples


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
        return to_16k(pcm / 32768, w.getframerate())


# -- synthetic questions -----------------------------------------------------------------


def synth_questions(folder: Path) -> list[dict]:
    """One clip per question, voices taken in turn. Returns {text, voice, audio (16 kHz)}."""
    from cairnly.voice.models import kokoro_model

    kokoro = kokoro_model()
    voices: list[tuple[str, object]] = [(label, ("kokoro", v, lang)) for v, lang, label in
                                        KOKORO_VOICES]
    if shutil.which("say") and shutil.which("afconvert"):
        voices += [(label, ("say", v, None)) for v, label in SAY_VOICES]
    clips = []
    for i, question in enumerate(QUESTIONS):
        label, (engine, voice, lang) = voices[i % len(voices)]
        if engine == "kokoro":
            samples, rate = kokoro.create(question, voice=voice, lang=lang, speed=1.0)
            audio = to_16k(np.asarray(samples, dtype=np.float32), rate)
        else:
            aiff, wav = folder / f"q{i}.aiff", folder / f"q{i}.wav"
            subprocess.run(["say", "-v", voice, "-o", str(aiff), question], check=True)
            subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{RATE}", "-c", "1",
                            str(aiff), str(wav)], check=True)
            audio = read_wav(wav)
        clips.append({"text": question, "voice": label, "audio": audio})
    return clips


# -- speech to text ------------------------------------------------------------------------


def whisper_engine():
    from faster_whisper import WhisperModel

    from cairnly.voice.models import transcribe as server_transcribe

    model = WhisperModel(WHISPER, device="cpu", compute_type="int8",
                         cpu_threads=min(12, os.cpu_count() or 4))

    def transcribe(audio: np.ndarray) -> str:  # exactly what the voice server does
        return server_transcribe(model, audio)

    return "Whisper large-v3-turbo (faster-whisper, int8, CPU)", transcribe


def parakeet_engine():
    import onnx_asr

    model = onnx_asr.load_model(PARAKEET, quantization="int8", providers=["CPUExecutionProvider"])

    def transcribe(audio: np.ndarray) -> str:
        return str(model.recognize(audio, sample_rate=RATE))

    return "Parakeet-TDT 0.6B v2 (onnx-asr, int8, CPU)", transcribe


def bench_stt(clips: list[dict], engines) -> list[dict]:
    from jiwer import wer

    rows = []
    audio_s = sum(len(c["audio"]) for c in clips) / RATE
    for make in engines:
        start = time.perf_counter()
        name, transcribe = make()
        load_s = time.perf_counter() - start
        transcribe(clips[0]["audio"])  # warm-up, not timed
        refs, hyps, times = [], [], []
        for clip in clips:
            t = time.perf_counter()
            text = transcribe(clip["audio"])
            times.append(time.perf_counter() - t)
            refs.append(normalize(clip["text"]))
            hyps.append(normalize(text))
            clip.setdefault("heard", {})[name] = text
        per = [wer(r, h) for r, h in zip(refs, hyps, strict=True)]
        rows.append({"engine": name, "wer": wer(refs, hyps), "rtf": sum(times) / audio_s,
                     "median_ms": round(statistics.median(times) * 1000),
                     "exact": sum(p == 0 for p in per), "clips": len(clips),
                     "audio_s": round(audio_s, 1), "load_s": round(load_s, 1)})
    return rows


# -- text to speech ------------------------------------------------------------------------


def kokoro_tts():
    from cairnly.voice.models import kokoro_model

    kokoro = kokoro_model()

    def first_and_total(text: str) -> tuple[float, float, float]:
        async def run():
            t = time.perf_counter()
            first, seconds = None, 0.0
            async for samples, rate in kokoro.create_stream(text, voice="af_heart",
                                                             lang="en-us"):
                first = first if first is not None else time.perf_counter() - t
                seconds += len(samples) / rate
            return first, time.perf_counter() - t, seconds

        return asyncio.run(run())

    return "Kokoro-82M (kokoro-onnx, CPU)", first_and_total


def piper_tts(folder: Path):
    from piper import PiperVoice
    from piper.download_voices import download_voice

    download_voice(PIPER_VOICE, folder)
    voice = PiperVoice.load(folder / f"{PIPER_VOICE}.onnx")

    def first_and_total(text: str) -> tuple[float, float, float]:
        t = time.perf_counter()
        first, seconds = None, 0.0
        for chunk in voice.synthesize(text):
            first = first if first is not None else time.perf_counter() - t
            seconds += len(chunk.audio_float_array) / chunk.sample_rate
        return first, time.perf_counter() - t, seconds

    return f"Piper {PIPER_VOICE} (onnx, CPU)", first_and_total


def bench_tts(engines) -> list[dict]:
    rows = []
    for make in engines:
        name, run = make()
        run(SENTENCES[0])  # warm-up
        firsts, compute, audio = [], 0.0, 0.0
        for sentence in SENTENCES:
            first, total, seconds = run(sentence)
            firsts.append(first)
            compute += total
            audio += seconds
        rows.append({"engine": name, "first_audio_ms": round(statistics.median(firsts) * 1000),
                     "rtf": compute / audio, "sentences": len(SENTENCES),
                     "audio_s": round(audio, 1)})
    return rows


# -- end to end ----------------------------------------------------------------------------


async def e2e_turn(audio: np.ndarray, api: str, voice: str) -> dict:
    import httpx
    from websockets.asyncio.client import connect

    conv = httpx.post(f"{api}/conversations").json()["id"]
    start = httpx.post(f"{voice}/voice/calls", json={"conversation_id": conv,
                                                    "key": uuid.uuid4().hex}).json()
    url = voice.replace("http", "ws", 1) + start["socket_path"]
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes()
    marks: dict[str, float] = {}
    async with connect(url) as ws:
        async def read():
            stage = "greeting"
            async for message in ws:
                now = time.perf_counter()
                if isinstance(message, bytes):
                    if stage == "asked" and "holding_audio" not in marks:
                        marks["holding_audio"] = now
                    if stage == "answer" and "answer_audio" not in marks:
                        marks["answer_audio"] = now
                    continue
                event = json.loads(message)
                if event["kind"] == "caption.user" and "transcript" not in marks:
                    marks["transcript"], stage = now, "asked"
                elif (event["kind"] == "caption.bot" and stage == "asked"
                      and not event.get("holding")):
                    marks["answer_caption"], stage = now, "answer"
                if "answer_audio" in marks:
                    return

        reader = asyncio.create_task(read())
        await asyncio.sleep(6)  # let the greeting finish
        for i in range(0, len(pcm), 640):
            await ws.send(pcm[i:i + 640])
            await asyncio.sleep(0.02)
        marks["speech_end"] = time.perf_counter()
        silence = bytes(640)
        while not reader.done() and time.perf_counter() - marks["speech_end"] < 60:
            await ws.send(silence)
            await asyncio.sleep(0.02)
        await ws.send(json.dumps({"kind": "call.hangup"}))
        reader.cancel()
    httpx.delete(f"{api}/conversations/{conv}")
    end = marks["speech_end"]
    return {k: round((v - end) * 1000) for k, v in marks.items() if k != "speech_end"}


def bench_e2e(clips: list[dict], api: str, voice: str) -> dict:
    turns = []
    for clip in clips[:5]:
        turns.append(asyncio.run(e2e_turn(clip["audio"], api, voice)))
        time.sleep(2)  # the previous call closes
    keys = ("transcript", "holding_audio", "answer_caption", "answer_audio")
    return {"turns": turns,
            "median_ms": {k: statistics.median(t[k] for t in turns if k in t) for k in keys}}


def table(rows: list[dict], cols: list[tuple[str, str, str]]) -> str:
    head = "| " + " | ".join(c[1] for c in cols) + " |"
    line = "|" + "|".join("---" for _ in cols) + "|"
    body = ["| " + " | ".join(format(r[c[0]], c[2]) for c in cols) + " |" for r in rows]
    return "\n".join([head, line, *body])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", help="write the JSON report here (evals/last-*.json is ignored)")
    parser.add_argument("--e2e", action="store_true", help="also time turns through the servers")
    parser.add_argument("--api", default="http://localhost:8010")
    parser.add_argument("--voice", default="http://localhost:8020")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="cairnly-voice-bench-") as tmp:
        folder = Path(tmp)
        clips = synth_questions(folder)
        stt = bench_stt(clips, [whisper_engine, parakeet_engine])
        tts = bench_tts([kokoro_tts, lambda: piper_tts(folder)])
        e2e = bench_e2e(clips, args.api, args.voice) if args.e2e else None
    report = {"hardware": hardware(), "audio": "synthetic (text to speech, see voices)",
              "voices": sorted({c["voice"] for c in clips}), "stt": stt, "tts": tts, "e2e": e2e,
              "misheard": [{"text": c["text"], "voice": c["voice"], **c["heard"]} for c in clips
                           if any(normalize(h) != normalize(c["text"])
                                  for h in c["heard"].values())]}
    print(f"Hardware: {report['hardware']}\nAudio: {len(clips)} synthetic questions, voices: "
          f"{', '.join(report['voices'])}\n")
    print(table(stt, [("engine", "Speech to text", "s"), ("wer", "WER", ".1%"),
                      ("rtf", "RTF", ".3f"), ("median_ms", "Median ms", "d"),
                      ("exact", "Exact", "d"), ("load_s", "Load s", "")]))
    print()
    print(table(tts, [("engine", "Text to speech", "s"), ("first_audio_ms", "First audio ms", "d"),
                      ("rtf", "RTF", ".3f")]))
    if e2e:
        print("\nEnd to end (ms after the caller stops speaking, median of 5):",
              json.dumps(e2e["median_ms"]))
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=1, default=float))


if __name__ == "__main__":
    main()
