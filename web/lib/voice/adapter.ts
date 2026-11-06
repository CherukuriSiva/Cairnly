// The seam between the voice controller and the browser. The controller only sees these
// interfaces; browser.ts implements them with getUserMedia, WebSocket or RTCPeerConnection and
// Web Audio, and tests implement them with plain objects.

import type { StartReply, Transport, VoiceEvent } from "@/lib/voice/types";

/** The browser refused the microphone (NotAllowedError) or has none. */
export class MicError extends Error {
  constructor(readonly kind: "mic-denied" | "no-mic") {
    super(kind);
    this.name = "MicError";
  }
}

export interface LinkHandlers {
  onEvent: (event: VoiceEvent) => void;
  /** The connection closed (after a hang-up, or on its own). */
  onClosed: () => void;
}

/** One open call. */
export interface VoiceLink {
  send(message: { kind: string }): void;
  setMuted(muted: boolean): void;
  /** RMS of the caller's microphone and of the bot's audio right now, each 0..1. */
  levels(): { user: number; bot: number };
  /** Close the channel, then the connection once it reports closed or after ~500 ms. Also
   * releases the microphone. Safe to call twice. */
  close(): Promise<void>;
}

export interface ConnectOptions {
  transport: Transport;
  baseUrl: string;
  /** Starts the call on the server; WebRTC passes its SDP offer. */
  start: (offer?: { sdp: string; type: "offer" }) => Promise<StartReply>;
  iceServers?: string[];
  handlers: LinkHandlers;
}

export interface VoiceAdapter {
  /** Called synchronously inside the click, before any await: resumes the audio context and
   * unlocks the audio element (iOS plays nothing that was not started by a gesture). */
  prepare(): void;
  /** The microphone, with echo cancellation and noise suppression. Throws MicError. */
  openMic(): Promise<void>;
  /** Connect the call; resolves once the media path is up. */
  connect(options: ConnectOptions): Promise<VoiceLink>;
  /** Release the microphone and audio without a call (a start that failed half-way). */
  release(): void;
}

/** Parse a server message; anything unexpected is dropped, never fatal. */
export function parseVoiceEvent(data: unknown): VoiceEvent | null {
  let value: unknown = data;
  if (typeof data === "string") {
    try {
      value = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  switch (e.kind) {
    case "call.ready":
      return typeof e.call_id === "string" && typeof e.max_seconds === "number" ? (e as unknown as VoiceEvent) : null;
    case "caption.user":
    case "caption.bot":
      return typeof e.text === "string" ? (e as unknown as VoiceEvent) : null;
    case "turn.saved":
      return typeof e.message_id === "number" ? (e as unknown as VoiceEvent) : null;
    case "call.ending":
      return typeof e.seconds_left === "number" ? (e as unknown as VoiceEvent) : null;
    case "call.closed":
      return typeof e.reason === "string" ? (e as unknown as VoiceEvent) : null;
    case "audio.clear":
      return { kind: "audio.clear" };
    default:
      return null;
  }
}
