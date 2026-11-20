// The voice call as a pure state machine: actions in, state out. The controller feeds it what
// happens (the server's events, audio levels every ~100 ms, a clock tick every second), and
// tests feed it by hand.
//
//   idle -> connecting -> greeting -> listening <-> thinking <-> speaking -> ended(reason)
//                     \-> failed(kind)            (any call phase) -> ended / failed
//
// Who is speaking comes from the audio itself: the bot counts as speaking while its output is
// above a small threshold, held for 1.2 s so the gaps between sentences do not flicker, and a
// new bot caption switches to speaking at once. A bot that goes quiet before its answer has
// started (only the holding line was said) is still thinking.

import type { EndReason, VoiceEvent, VoiceFailure, VoiceState } from "@/lib/voice/types";

export const SPEAKING_THRESHOLD = 0.02; // RMS of the bot's output that counts as speech
export const SPEAKING_HOLD_MS = 1_200;
export const ENDING_NOTICE_S = 30;

export type VoiceAction =
  | { type: "offer"; offered: boolean }
  | { type: "status"; available: boolean; said?: boolean }
  | { type: "start" }
  | { type: "waking"; now: number }
  | { type: "woke" }
  | { type: "ready"; callId: string; maxSeconds: number; now: number }
  | { type: "event"; event: VoiceEvent; now: number }
  | { type: "levels"; user: number; bot: number; now: number }
  | { type: "tick"; now: number }
  | { type: "mute"; muted: boolean }
  | { type: "closing" }
  | { type: "ended"; reason: EndReason }
  | { type: "failed"; failure: VoiceFailure }
  | { type: "dismiss" }
  | { type: "cooled" }; // a minute after a refusal: offer the mic again

export const initialVoiceState: VoiceState = {
  phase: "idle",
  offered: false,
  available: null,
  saidUnavailable: false,
  wakingSince: null,
  wakingSeconds: null,
  callId: null,
  deadline: null,
  secondsLeft: null,
  endingSoon: false,
  userCaption: "",
  botCaption: "",
  awaitingAnswer: false,
  botVoiceAt: 0,
  greeted: false,
  muted: false,
  closing: false,
  savedIds: [],
  endReason: null,
  failure: null,
  userLevel: 0,
  botLevel: 0,
};

/** The microphone button shows once the page offers voice, and hides for a minute after a
 * refusal. The voice server is not asked anything before the reader clicks it (asking would
 * wake its GPU for every visit), and each click after a refusal asks it again. */
export function showMic(state: VoiceState): boolean {
  return state.offered && state.available !== false && !state.closing && !inCall(state);
}

/** A call is in progress (or being set up): the composer shows the voice panel. */
export function inCall(state: VoiceState): boolean {
  return ["connecting", "greeting", "listening", "thinking", "speaking"].includes(state.phase);
}

function botSpeaking(state: VoiceState, now: number): boolean {
  return now - state.botVoiceAt < SPEAKING_HOLD_MS;
}

/** The phase that follows from who is talking, once connected. */
function settle(state: VoiceState, now: number): VoiceState {
  if (!["greeting", "listening", "thinking", "speaking"].includes(state.phase)) return state;
  if (botSpeaking(state, now)) {
    return state.phase === "greeting" ? state : { ...state, phase: "speaking" };
  }
  if (state.phase === "greeting") {
    // Still waiting for the greeting's first sound (it is being synthesised): keep greeting.
    return state.botVoiceAt === 0 ? state : { ...state, phase: "listening", greeted: true };
  }
  return { ...state, phase: state.awaitingAnswer ? "thinking" : "listening" };
}

function onEvent(state: VoiceState, event: VoiceEvent, now: number): VoiceState {
  switch (event.kind) {
    case "call.ready":
      return state; // handled by the "ready" action, which carries the browser clock
    case "caption.user": {
      // A new turn starts when the caller speaks after the bot's last words.
      const fresh = !state.awaitingAnswer;
      return {
        ...state,
        phase: "thinking",
        greeted: true,
        awaitingAnswer: true,
        userCaption: fresh ? event.text : `${state.userCaption} ${event.text}`.trim(),
        botCaption: fresh ? "" : state.botCaption,
      };
    }
    case "caption.bot": {
      const answering = state.awaitingAnswer && !event.holding;
      const botCaption = event.holding || !state.botCaption || state.phase === "greeting" ? event.text : `${state.botCaption} ${event.text}`;
      return {
        ...state,
        botCaption: answering ? event.text : botCaption,
        awaitingAnswer: event.holding ? state.awaitingAnswer : false,
        botVoiceAt: now,
        phase: state.phase === "greeting" ? "greeting" : "speaking",
      };
    }
    case "turn.saved":
      return state.savedIds.includes(event.message_id) ? state : { ...state, savedIds: [...state.savedIds, event.message_id] };
    case "call.ending":
      return { ...state, endingSoon: true };
    case "call.closed":
      return { ...state, endReason: state.endReason ?? event.reason, closing: true };
    case "audio.clear":
      // The caller talked over the bot: its queued audio is gone, so it is no longer speaking.
      return { ...state, botVoiceAt: 0, phase: state.phase === "speaking" || state.phase === "greeting" ? "listening" : state.phase, greeted: true };
  }
}

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    case "offer":
      return state.offered === action.offered ? state : { ...state, offered: action.offered };
    case "status": {
      const saidUnavailable = !action.available && Boolean(action.said);
      if (state.available === action.available && state.saidUnavailable === saidUnavailable) return state;
      return { ...state, available: action.available, saidUnavailable };
    }
    case "start":
      if (inCall(state) || state.closing) return state;
      return { ...initialVoiceState, offered: state.offered, available: state.available, phase: "connecting" };
    case "waking":
      if (state.phase !== "connecting" || state.wakingSince !== null) return state;
      return { ...state, wakingSince: action.now, wakingSeconds: 0 };
    case "woke":
      return state.wakingSince === null ? state : { ...state, wakingSince: null, wakingSeconds: null };
    case "ready":
      if (state.phase !== "connecting") return state;
      return {
        ...state,
        phase: "greeting",
        wakingSince: null,
        wakingSeconds: null,
        callId: action.callId,
        deadline: action.now + action.maxSeconds * 1000,
        secondsLeft: action.maxSeconds,
        endingSoon: action.maxSeconds <= ENDING_NOTICE_S,
      };
    case "event":
      if (!inCall(state)) return state;
      return onEvent(state, action.event, action.now);
    case "levels": {
      if (!inCall(state)) return state;
      const heard = action.bot > SPEAKING_THRESHOLD;
      const next = { ...state, userLevel: action.user, botLevel: action.bot, botVoiceAt: heard ? action.now : state.botVoiceAt };
      return settle(next, action.now);
    }
    case "tick": {
      if (state.wakingSince !== null && state.phase === "connecting") {
        const wakingSeconds = Math.max(0, Math.floor((action.now - state.wakingSince) / 1000));
        return wakingSeconds === state.wakingSeconds ? state : { ...state, wakingSeconds };
      }
      if (state.deadline === null || !inCall(state)) return state;
      const secondsLeft = Math.max(0, Math.ceil((state.deadline - action.now) / 1000));
      if (secondsLeft === state.secondsLeft) return state;
      return { ...state, secondsLeft, endingSoon: state.endingSoon || secondsLeft <= ENDING_NOTICE_S };
    }
    case "mute":
      return state.muted === action.muted ? state : { ...state, muted: action.muted };
    case "closing":
      return state.closing ? state : { ...state, closing: true };
    case "ended":
      return { ...state, phase: "ended", endReason: state.endReason ?? action.reason, closing: false, wakingSince: null, wakingSeconds: null, userLevel: 0, botLevel: 0 };
    case "failed":
      return { ...state, phase: "failed", failure: action.failure, closing: false, wakingSince: null, wakingSeconds: null, userLevel: 0, botLevel: 0 };
    case "dismiss":
      return inCall(state) ? state : { ...initialVoiceState, offered: state.offered, available: state.available, saidUnavailable: state.saidUnavailable };
    case "cooled": {
      // Not asked yet again (null): the mic shows, and its next click asks the server.
      if (state.available !== false) return state;
      const refusal = state.phase === "failed" && state.failure === "unavailable";
      return refusal ? { ...initialVoiceState, offered: state.offered, available: null } : { ...state, available: null, saidUnavailable: false };
    }
  }
}

/** Shown under the orb. */
export function phaseLabel(state: VoiceState): string {
  switch (state.phase) {
    case "connecting":
      return state.wakingSeconds !== null ? "Waking the voice model…" : "Connecting…";
    case "greeting":
      return "Cairnly is saying hello";
    case "listening":
      return state.muted ? "Muted" : "Listening";
    case "thinking":
      return "Looking it up";
    case "speaking":
      return "Cairnly is speaking";
    default:
      return "";
  }
}

/** What to say after a call, by how it ended. */
export function endLine(reason: EndReason | null): string {
  switch (reason) {
    case "farewell":
      return "Call ended. Goodbye!";
    case "idle":
      return "Call ended because it went quiet.";
    case "max_duration":
      return "Call ended: that was the time limit for one call.";
    case "replaced":
      return "This call was replaced by a newer one.";
    case "error":
      return "The call ended because of a problem.";
    default:
      return "Call ended.";
  }
}

/** What to say when a call could not start or broke. */
export function failureLine(failure: VoiceFailure | null): string {
  switch (failure) {
    case "mic-denied":
      return "Microphone access is blocked. Allow it for this site in your browser settings to talk to Cairnly.";
    case "no-mic":
      return "No microphone was found. You can keep typing your questions.";
    case "unavailable":
      return "Voice isn't available right now.";
    default:
      return "The call dropped. You can try again or keep typing.";
  }
}

/** m:ss */
export function clockText(seconds: number | null): string {
  if (seconds === null) return "";
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
