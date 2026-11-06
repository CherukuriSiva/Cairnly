"""One call from connect to hang-up: builds the pipeline, runs the call's timers, and ends it.

A call ends in one of these ways (its reason is recorded in the CallBook):

- the caller says goodbye (farewell), or stays silent for `idle_s` (idle), or the call reaches
  its length (max_duration): the bot says a short goodbye first, then the call closes;
- the caller presses End call (hung_up): no goodbye, the call closes at once;
- a new call on the same conversation (replaced), or the browser goes away (hung_up);
- something breaks (error).

Closing means: send `call.closed` with the reason, then end the pipeline, which closes the
socket or the peer connection. Audio is never written anywhere.
"""

import asyncio
import json
import logging
import time

from pipecat.frames.frames import (
    EndFrame,
    Frame,
    InputAudioRawFrame,
    InputTransportMessageFrame,
    InterruptionFrame,
    OutputAudioRawFrame,
    OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.workers.runner import WorkerRunner

from cairnly.voice import protocol, speech
from cairnly.voice.answers import AnswerSource
from cairnly.voice.calls import CONNECT_WINDOW_S, Call, CallBook, CallClock
from cairnly.voice.flow import AudioTap, CallBrain, MicGate, SayFrame
from cairnly.voice.models import SpeechServices
from cairnly.voice.settings import VoiceSettings

log = logging.getLogger("cairnly.voice")

TICK_S = 0.5
MAX_AUDIO_MESSAGE = 64_000  # bytes; 2 s of 16 kHz audio, far more than a 20 ms chunk
LINE_GRACE_S = 3.0  # how long past its expected length a goodbye may take to play


class CallSocketSerializer(FrameSerializer):
    """The WebSocket protocol (protocol.py): binary frames are PCM audio, text frames JSON."""

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, OutputAudioRawFrame):
            return frame.audio
        if isinstance(frame, (OutputTransportMessageFrame, OutputTransportMessageUrgentFrame)):
            return None if self.should_ignore_frame(frame) else json.dumps(frame.message)
        if isinstance(frame, InterruptionFrame):
            return json.dumps(protocol.CLEAR)
        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, bytes):
            if not data or len(data) > MAX_AUDIO_MESSAGE:
                return None
            return InputAudioRawFrame(audio=data[: len(data) // 2 * 2],
                                      sample_rate=protocol.IN_RATE, num_channels=1)
        try:
            message = json.loads(data)
        except (json.JSONDecodeError, TypeError):
            return None
        if protocol.client_message(message) is None:
            return None
        return InputTransportMessageFrame(message=message)


class CallSession:
    def __init__(self, call: Call, book: CallBook, settings: VoiceSettings,
                 services: SpeechServices, answers: AnswerSource):
        self.call, self.book, self.settings = call, book, settings
        self.services, self.answers = services, answers
        self.worker: PipelineWorker | None = None
        self.clock: CallClock | None = None
        self.ticker: asyncio.Task | None = None
        self.ending: asyncio.Task | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self.tap = AudioTap()
        self.brain = CallBrain(answers=answers, conversation_id=call.conversation_id,
                               session_id=call.id, on_farewell=self._farewell,
                               on_hangup=self._caller_hung_up, tap=self.tap)

    def build(self, transport) -> PipelineWorker:
        processors = [transport.input()]
        if self.settings.half_duplex:
            processors.append(MicGate())
        processors += [VADProcessor(vad_analyzer=self.services.vad()), self.services.stt(),
                       self.brain, self.services.tts(), self.tap, transport.output()]
        self.worker = PipelineWorker(
            Pipeline(processors),
            params=PipelineParams(audio_in_sample_rate=protocol.IN_RATE,
                                  audio_out_sample_rate=protocol.OUT_RATE),
            enable_rtvi=False, enable_turn_tracking=False, idle_timeout_secs=None,
            cancel_on_idle_timeout=False, name=f"call-{self.call.id[:8]}")

        @transport.event_handler("on_client_connected")
        async def _connected(_transport, _client):
            await self._connected()

        @transport.event_handler("on_client_disconnected")
        async def _disconnected(_transport, _client):
            await self._gone()

        return self.worker

    async def run(self, transport) -> None:
        """Run the call until it ends; always records how it ended."""
        self.loop = asyncio.get_running_loop()
        self.call.hangup = self._hangup_from_book
        worker = self.build(transport)
        runner = WorkerRunner(handle_sigint=False)
        watchdog = asyncio.create_task(self._connect_watchdog())
        try:
            await runner.add_workers(worker)
            await runner.run()
        except Exception:
            log.exception("voice call failed")
            self.book.finish(self.call.id, "error")
        finally:
            for task in (self.ticker, self.ending, watchdog):
                if task is not None and not task.done():
                    task.cancel()
            self.book.finish(self.call.id, self.call.end_reason or "hung_up")
            close = getattr(self.answers, "close", None)
            if close is not None:
                await close()
            log.info("voice call ended: %s", self.call.end_reason)

    async def _connect_watchdog(self) -> None:
        """A caller who never connects (a blocked WebRTC path) does not hold the call."""
        await asyncio.sleep(CONNECT_WINDOW_S)
        if self.clock is None and self.worker is not None:
            log.warning("voice caller never connected")
            self.book.finish(self.call.id, "error")
            await self.worker.cancel(reason="caller never connected")

    # -- lifecycle ---------------------------------------------------------------------------

    async def _connected(self) -> None:
        call = self.book.went_live(self.call.id)
        if call is None:  # replaced or given up before it connected
            await self._close(self.call.end_reason or "replaced")
            return
        self.clock = CallClock(call.started_at, call.max_seconds, self.settings.idle_s,
                               self.settings.ending_notice_s)
        await self._queue(OutputTransportMessageUrgentFrame(
            message=protocol.ready(call.id, call.max_seconds)))
        await self._queue(SayFrame(text=speech.GREETING))
        self.ticker = asyncio.create_task(self._tick())

    async def _tick(self) -> None:
        while self.ending is None:
            await asyncio.sleep(TICK_S)
            if self.clock is None:
                continue
            action = self.clock.tick(time.time(), self.brain.busy)
            if action == "notice":
                await self._queue(OutputTransportMessageUrgentFrame(
                    message=protocol.ending(self.clock.seconds_left(time.time()))))
            elif action == "idle":
                self.end("idle", speech.IDLE)
            elif action == "time_up":
                self.end("max_duration", speech.TIME_UP)

    def end(self, reason: str, line: str | None = None) -> None:
        """Start ending the call (once): say `line` if given, then close."""
        if self.ending is not None:
            return
        self.book.closing(self.call.id, reason)
        self.ending = asyncio.create_task(self._end(reason, line))

    async def _end(self, reason: str, line: str | None) -> None:
        self.brain.ending = True
        await self.brain.stop_answer("interrupted")
        if line:
            if self.brain.bot_speaking:
                await self.brain.broadcast_interruption()  # stop what is still being said
            played = self.brain.watch_line()
            await self._queue(SayFrame(text=line))
            try:
                await asyncio.wait_for(played.wait(),
                                       len(line) * 0.08 + LINE_GRACE_S)  # ~12 chars a second
            except TimeoutError:
                log.warning("the goodbye line did not finish playing in time")
        await self._close(reason)

    async def _close(self, reason: str) -> None:
        self.book.closing(self.call.id, reason)
        await self._queue(OutputTransportMessageUrgentFrame(message=protocol.closed(
            self.call.end_reason or reason)))
        await asyncio.sleep(0.1)  # let the event leave before the socket closes
        await self._queue(EndFrame())

    async def _farewell(self) -> None:
        self.end("farewell", speech.FAREWELL)

    async def _caller_hung_up(self) -> None:
        if self.ending is None:
            self.book.closing(self.call.id, "hung_up")
            self.ending = asyncio.create_task(self._close("hung_up"))

    async def _gone(self) -> None:
        """The browser went away without hanging up."""
        self.book.closing(self.call.id, "hung_up")
        if self.worker is not None:
            await self.worker.cancel(reason="caller disconnected")

    def _hangup_from_book(self, reason: str) -> None:
        """The CallBook ends this call (it was replaced): may come from another task."""
        if self.loop is None:
            return
        line = None if reason in ("replaced", "hung_up") else speech.FAREWELL
        self.loop.call_soon_threadsafe(self.end, reason, line)

    async def _queue(self, frame: Frame) -> None:
        if self.worker is not None and not self.worker.has_finished():
            await self.worker.queue_frame(frame)


def websocket_transport(websocket, origins: list[str]):
    from pipecat.transports.websocket.fastapi import (
        FastAPIWebsocketParams,
        FastAPIWebsocketTransport,
    )

    return FastAPIWebsocketTransport(websocket, FastAPIWebsocketParams(
        audio_in_enabled=True, audio_out_enabled=True,
        audio_in_sample_rate=protocol.IN_RATE, audio_out_sample_rate=protocol.OUT_RATE,
        audio_out_end_silence_secs=0, serializer=CallSocketSerializer(),
        allowed_origins=origins))


def webrtc_transport(connection):
    from pipecat.transports.base_transport import TransportParams
    from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

    return SmallWebRTCTransport(webrtc_connection=connection, params=TransportParams(
        audio_in_enabled=True, audio_out_enabled=True,
        audio_in_sample_rate=protocol.IN_RATE, audio_out_sample_rate=protocol.OUT_RATE,
        audio_out_end_silence_secs=0))
