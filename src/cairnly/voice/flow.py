"""The Pipecat processors that make a call a conversation with cairnly.

The pipeline of one call (session.py builds it):

    caller audio -> [MicGate] -> VAD (Silero) -> speech to text (Whisper) -> CallBrain
                 -> text to speech (Kokoro) -> AudioTap -> caller

- CallBrain turns each finished thing the caller said into a question for the cairnly API, says
  a holding line at once, then speaks the answer sentence by sentence as its tokens arrive. It
  also sends the captions, and stops the bot when the caller talks over it (barge-in).
- MicGate is the half-duplex switch: while the bot speaks, the caller's audio is replaced by
  silence, so nothing they say interrupts it.
- AudioTap watches the synthesised audio pass, to time the first sound of each turn.

Captions go out as transport messages. A bot caption is an ordinary (queued) message sent just
before its sentence, so the TTS service and the output transport keep it in order with the audio
and it reaches the browser when the sentence starts playing. Other events are urgent: they go out
at once.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    DataFrame,
    Frame,
    InputAudioRawFrame,
    InputTransportMessageFrame,
    OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    TTSSpeakFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from cairnly.voice import protocol, speech
from cairnly.voice.answers import AnswerSource, AskFailed
from cairnly.voice.timings import TurnTimings

log = logging.getLogger("cairnly.voice")

GREETING_ECHO_WINDOW_S = 12  # transcripts this soon after the greeting may be its echo
FAILURE_LINES = {"rate": speech.TOO_MANY, "busy": speech.BUSY, "gone": speech.GONE}


@dataclass
class SayFrame(DataFrame):
    """A fixed line for the bot to say with its caption (the greeting, a goodbye). Queued from
    outside the pipeline by the session; CallBrain speaks it."""

    text: str = ""


class CallBrain(FrameProcessor):
    def __init__(self, *, answers: AnswerSource, conversation_id: str, session_id: str,
                 on_farewell: Callable[[], Awaitable[None]] | None = None,
                 on_hangup: Callable[[], Awaitable[None]] | None = None,
                 tap: "AudioTap | None" = None, clock: Callable[[], float] = time.monotonic):
        super().__init__(name="CallBrain")
        self.answers, self.conversation_id, self.session_id = answers, conversation_id, session_id
        self.on_farewell, self.on_hangup, self.tap, self.clock = on_farewell, on_hangup, tap, clock
        self.started = clock()
        self.user_speaking = False
        self.bot_speaking = False
        self.answer_task = None
        self.pending = ""  # what the caller said that has not been answered yet
        self.answer_heard = False  # this turn's answer (not just the holding line) was sent
        self.answered_once = False
        self.ending = False
        self.speech_end: float | None = None
        self.turn: TurnTimings | None = None
        self.line_done: asyncio.Event | None = None  # set once a watched line has been played
        self.line_started = False

    @property
    def busy(self) -> bool:
        """Someone is talking or an answer is on its way (idle hang-up waits)."""
        return self.user_speaking or self.bot_speaking or self.answer_task is not None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, VADUserStartedSpeakingFrame):
            self.user_speaking = True
            await self.push_frame(frame, direction)
            if not self.ending and (self.answer_task is not None or self.bot_speaking):
                await self.barge_in()
        elif isinstance(frame, VADUserStoppedSpeakingFrame):
            self.user_speaking = False
            self.speech_end = self.clock()
            await self.push_frame(frame, direction)
        elif isinstance(frame, TranscriptionFrame):
            await self._heard(frame)
        elif isinstance(frame, BotStartedSpeakingFrame):
            self.bot_speaking = True
            self.line_started = self.line_done is not None
            await self.push_frame(frame, direction)
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self.bot_speaking = False
            if self.line_done is not None and self.line_started:
                self.line_done.set()
            await self.push_frame(frame, direction)
        elif isinstance(frame, SayFrame):
            await self._speak(frame.text)
        elif isinstance(frame, InputTransportMessageFrame):
            if protocol.client_message(frame.message) == protocol.HANGUP and self.on_hangup:
                await self.on_hangup()
        else:
            await self.push_frame(frame, direction)

    def watch_line(self) -> asyncio.Event:
        """An event set when the next line the bot starts saying has finished playing."""
        self.line_done, self.line_started = asyncio.Event(), False
        return self.line_done

    async def event(self, message: dict) -> None:
        """Send an event to the browser at once."""
        await self.push_frame(OutputTransportMessageUrgentFrame(message=message))

    async def barge_in(self) -> None:
        """The caller talks over the bot: stop the answer and everything queued to be said."""
        await self.stop_answer("interrupted")
        await self.broadcast_interruption()

    async def stop_answer(self, outcome: str) -> None:
        task, self.answer_task = self.answer_task, None
        if task is not None:
            await self.cancel_task(task)
            if self.turn is not None:
                self._close_turn(outcome)
        if self.answer_heard:  # the caller heard (part of) the answer: next words are new
            self.pending = ""

    async def _heard(self, frame: TranscriptionFrame) -> None:
        text = frame.text.strip()
        if not text:
            return
        if (not self.answered_once and self.clock() - self.started < GREETING_ECHO_WINDOW_S
                and speech.is_greeting_echo(text)):
            log.info("dropped a transcript that echoes the greeting")
            return
        await self.event(protocol.user_caption(text))
        if self.ending:
            return
        if not self.pending and speech.is_farewell(text):
            if self.on_farewell:
                await self.on_farewell()
            return
        self.pending = f"{self.pending} {text}".strip()
        if not frame.finalized or self.user_speaking:
            return  # the caller is still talking: the question goes on
        question = self.pending
        self.answer_heard = False
        self.turn = TurnTimings(self.clock)
        self.turn.mark("speech_end", self.speech_end or self.clock())
        self.turn.mark("transcript")
        self.answer_task = self.create_task(self._answer(question, self.turn))

    async def _answer(self, question: str, turn: TurnTimings) -> None:
        if self.tap is not None:
            self.tap.watch(turn, holding=True, on_audio=self._turn_audio)
        await self._speak(speech.HOLDING, holding=True)
        outcome = "answered"
        try:
            outcome = await self._stream(question, turn)
        except AskFailed as exc:
            log.warning("voice question failed: %s", exc.kind)
            await self._speak(FAILURE_LINES.get(exc.kind, speech.TROUBLE), answer=True)
            outcome = "error"
        self.pending = ""
        self.answered_once = True
        self.answer_task = None
        turn.mark("done")
        self._close_turn(outcome)

    async def _stream(self, question: str, turn: TurnTimings) -> str:
        chunker = speech.SpeechChunker()
        async for event in self.answers.ask(question, self.conversation_id, self.session_id):
            kind = event["type"]
            if kind == "token":
                turn.mark("first_token")
                for sentence in chunker.feed(str(event.get("text", ""))):
                    await self._speak(sentence, answer=True)
            elif kind == "retract":  # the output check withdrew the answer: say why instead
                chunker = speech.SpeechChunker()
                await self.broadcast_interruption()
                for sentence in speech.speakable(str(event.get("message", ""))):
                    await self._speak(sentence, answer=True)
            elif kind == "done":
                for sentence in chunker.flush():
                    await self._speak(sentence, answer=True)
                if isinstance(event.get("message_id"), int):
                    await self.event(protocol.saved(event["message_id"]))
                return "refused" if event.get("refused") else "answered"
            elif kind == "error":
                await self._speak(speech.TROUBLE, answer=True)
                return "error"
        await self._speak(speech.TROUBLE, answer=True)  # the stream ended without `done`
        return "error"

    async def _speak(self, text: str, answer: bool = False, holding: bool = False) -> None:
        if answer:
            self.answer_heard = True
        await self.push_frame(OutputTransportMessageFrame(
            message=protocol.bot_caption(text, holding)))
        await self.push_frame(TTSSpeakFrame(text, append_to_context=False))

    def _turn_audio(self, turn: TurnTimings) -> None:
        if turn.outcome is not None:
            turn.emit(self.session_id)

    def _close_turn(self, outcome: str) -> None:
        turn = self.turn
        if turn is None or turn.outcome is not None:
            return
        turn.outcome = outcome
        # Report once the first answer audio exists; a turn cut short reports what it has.
        if "first_audio" in turn.at or outcome == "interrupted":
            turn.emit(self.session_id)


class MicGate(FrameProcessor):
    """Half duplex: the caller's audio is silence while the bot speaks, plus a short tail for
    the bot's last word to leave the room."""

    def __init__(self, tail_s: float = 0.4, clock: Callable[[], float] = time.monotonic):
        super().__init__(name="MicGate")
        self.tail_s, self.clock = tail_s, clock
        self.bot_speaking = False
        self.open_at = 0.0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, BotStartedSpeakingFrame):
            self.bot_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self.bot_speaking = False
            self.open_at = self.clock() + self.tail_s
        elif isinstance(frame, InputAudioRawFrame) and (
                self.bot_speaking or self.clock() < self.open_at):
            frame = InputAudioRawFrame(audio=bytes(len(frame.audio)),
                                       sample_rate=frame.sample_rate,
                                       num_channels=frame.num_channels)
        await self.push_frame(frame, direction)


class AudioTap(FrameProcessor):
    """Marks when a turn's audio is first synthesised: the holding line's, then the answer's.
    Speech contexts seen before `watch` (the greeting) are ignored."""

    def __init__(self):
        super().__init__(name="AudioTap")
        self.seen: set[str] = set()
        self.turn: TurnTimings | None = None
        self.new: list[str] = []
        self.holding = False
        self.on_audio: Callable[[TurnTimings], None] | None = None

    def watch(self, turn: TurnTimings, *, holding: bool,
              on_audio: Callable[[TurnTimings], None] | None = None) -> None:
        self.turn, self.holding, self.on_audio, self.new = turn, holding, on_audio, []

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TTSAudioRawFrame) and frame.context_id not in self.seen:
            self.seen.add(frame.context_id or "")
            if self.turn is not None:
                self.new.append(frame.context_id or "")
                if self.holding and len(self.new) == 1:
                    self.turn.mark("holding_audio")
                if len(self.new) == (2 if self.holding else 1):
                    self.turn.mark("first_audio")
                    if self.on_audio:
                        self.on_audio(self.turn)
        await self.push_frame(frame, direction)
