"""The messages a call exchanges with the browser, as JSON objects with a `kind`.

Server to browser (over the WebRTC data channel, or as text frames on the WebSocket):

    call.ready     {call_id, max_seconds}       the call is connected; the clock runs
    caption.user   {text}                       what the caller said (a finished turn)
    caption.bot    {text}                       a sentence the bot is about to speak
    turn.saved     {message_id}                 the answer was saved into the conversation
    call.ending    {seconds_left}               the call ends soon
    call.closed    {reason}                     the call is over (see calls.END_REASONS)
    audio.clear    {}                           WebSocket only: drop queued bot audio (barge-in)

Browser to server:

    call.hangup    {}                           the caller pressed End call

On the WebSocket, binary frames carry audio: 16 kHz 16-bit mono PCM from the browser, 24 kHz
16-bit mono PCM to it. Captions are not stored anywhere; only the saved messages are.
"""

IN_RATE = 16_000  # caller audio (Whisper and Silero want 16 kHz)
OUT_RATE = 24_000  # bot audio (Kokoro speaks at 24 kHz)


def ready(call_id: str, max_seconds: int) -> dict:
    return {"kind": "call.ready", "call_id": call_id, "max_seconds": max_seconds}


def user_caption(text: str) -> dict:
    return {"kind": "caption.user", "text": text}


def bot_caption(text: str) -> dict:
    return {"kind": "caption.bot", "text": text}


def saved(message_id: int) -> dict:
    return {"kind": "turn.saved", "message_id": message_id}


def ending(seconds_left: int) -> dict:
    return {"kind": "call.ending", "seconds_left": seconds_left}


def closed(reason: str) -> dict:
    return {"kind": "call.closed", "reason": reason}


CLEAR = {"kind": "audio.clear"}
HANGUP = "call.hangup"


def client_message(message: object) -> str | None:
    """The kind of a message from the browser, or None for anything unexpected."""
    if isinstance(message, dict) and isinstance(message.get("kind"), str):
        return message["kind"]
    return None
