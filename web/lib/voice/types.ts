// Voice mode as data: the call's phase, the captions and the clock. No React and no DOM: the
// browser parts (microphone, sockets, Web Audio) sit behind the adapter in adapter.ts.

/** How a call ended (the server records it; see src/cairnly/voice/calls.py). */
export type EndReason = "farewell" | "idle" | "max_duration" | "hung_up" | "replaced" | "error";

/** Why a call could not start or broke. */
export type VoiceFailure =
  | "mic-denied" // the browser or the reader refused the microphone
  | "no-mic" // no microphone, or no getUserMedia (an insecure page)
  | "unavailable" // voice is off, busy, or a daily limit is spent
  | "transport"; // the connection failed or dropped

export type VoicePhase =
  | "idle" // no call
  | "connecting" // microphone, conversation and connection being set up (and the GPU waking)
  | "greeting" // connected; the bot says hello
  | "listening" // the caller's turn
  | "thinking" // the caller finished; the answer is being looked up
  | "speaking" // the bot is talking
  | "ended" // the call is over (see endReason)
  | "failed"; // it broke or never started (see failure)

export type Transport = "websocket" | "webrtc";

/** Events from the voice server (src/cairnly/voice/protocol.py). */
export type VoiceEvent =
  | { kind: "call.ready"; call_id: string; max_seconds: number }
  | { kind: "caption.user"; text: string }
  | { kind: "caption.bot"; text: string; holding?: boolean }
  | { kind: "turn.saved"; message_id: number }
  | { kind: "call.ending"; seconds_left: number }
  | { kind: "call.closed"; reason: EndReason }
  | { kind: "audio.clear" };

/** GET /voice/status */
export interface VoiceStatus {
  available: boolean;
  reason: string | null;
  max_call_seconds: number;
  transports: Transport[];
  half_duplex: boolean;
  ice_servers?: string[]; // STUN servers for WebRTC
}

/** POST /voice/calls */
export interface StartReply {
  call_id: string;
  token: string;
  transport: Transport;
  max_seconds: number;
  socket_path?: string; // WebSocket calls
  answer?: { sdp: string; type: "answer" }; // WebRTC calls
}

export interface VoiceState {
  phase: VoicePhase;
  offered: boolean; // the page offers voice (the API saves conversations); nothing asked yet
  available: boolean | null; // null: not asked yet (the mic shows); false (a refusal) hides it for a minute
  saidUnavailable: boolean; // a call was refused, or the server could not be reached
  wakingSince: number | null; // ms since epoch: the first request to the voice server left
  wakingSeconds: number | null; // seconds since then, until the server answers the start
  callId: string | null;
  deadline: number | null; // ms since epoch, from the browser clock when the call connected
  secondsLeft: number | null;
  endingSoon: boolean; // 30 s or less left
  userCaption: string; // what the caller said this turn
  botCaption: string; // what the bot is saying this turn
  awaitingAnswer: boolean; // the caller's turn is final; the answer has not started yet
  botVoiceAt: number; // last time the bot's audio was above the speaking threshold
  greeted: boolean; // the greeting has finished
  muted: boolean;
  closing: boolean; // hanging up: no new call until the old one is closed
  savedIds: number[]; // answers saved during this call
  endReason: EndReason | null;
  failure: VoiceFailure | null;
  userLevel: number; // 0..1, for the orb
  botLevel: number;
}
