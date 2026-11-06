// Drives a voice call: asks the voice server whether calls are possible, starts one inside the
// reader's click, feeds the state machine (events, audio levels, the clock), hangs up
// gracefully, then reloads the saved conversation so the spoken turns show as normal messages.
// No React: the page subscribes to it (useSyncExternalStore), and tests run it with a fake
// adapter and a fake fetch.

import { inCall, initialVoiceState, voiceReducer, type VoiceAction } from "@/lib/voice/machine";
import { MicError, type VoiceAdapter, type VoiceLink } from "@/lib/voice/adapter";
import type { EndReason, StartReply, Transport, VoiceEvent, VoiceFailure, VoiceState, VoiceStatus } from "@/lib/voice/types";

/** The voice server; unset (the default) means no voice mode at all. */
export const VOICE_URL = (process.env.NEXT_PUBLIC_VOICE_URL ?? "").replace(/\/$/, "");

export const LEVELS_MS = 100;
export const TICK_MS = 1_000;
const MAX_CLOSING_WAIT_S = 3;
const DEFAULT_ICE = ["stun:stun.l.google.com:19302"];

/** What a call needs from the chat: a saved conversation to put the turns in, and a reload. */
export interface VoiceChat {
  ensureConversation(): Promise<string | null>;
  reload(): Promise<void>;
}

export interface VoiceControllerOptions {
  baseUrl: string;
  adapter: VoiceAdapter;
  chat: VoiceChat;
  /** A transport to prefer (?transport=webrtc); otherwise the server's first. */
  transport?: Transport | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  newKey?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

class StartError extends Error {
  constructor(readonly kind: "unavailable" | "closing" | "transport") {
    super(kind);
  }
}

function randomKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join("-");
}

export class VoiceController {
  private state: VoiceState = initialVoiceState;
  private listeners = new Set<() => void>();
  private status: VoiceStatus | null = null;
  private link: VoiceLink | null = null;
  private reply: StartReply | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private hungUp = false; // this side ended the call
  private finishing: Promise<void> | null = null;
  private disposed = false;

  constructor(private readonly options: VoiceControllerOptions) {}

  getState = (): VoiceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private get fetch(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private dispatch(action: VoiceAction): void {
    const next = voiceReducer(this.state, action);
    if (next === this.state) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  /** GET /voice/status. Anything but a clear "available" hides the microphone. */
  async checkStatus(): Promise<boolean> {
    let status: VoiceStatus | null = null;
    try {
      const res = await this.fetch(`${this.options.baseUrl}/voice/status`, { cache: "no-store" });
      const body = res.ok ? ((await res.json()) as Partial<VoiceStatus>) : null;
      if (body?.available === true && Array.isArray(body.transports) && body.transports.length > 0) status = body as VoiceStatus;
    } catch {
      // unreachable: no voice
    }
    if (this.disposed) return false;
    this.status = status;
    this.dispatch({ type: "status", available: status !== null });
    return status !== null;
  }

  /** Start a call. Call it synchronously from the click handler: the audio is unlocked here,
   * before anything is awaited. */
  start(): void {
    if (!this.status || inCall(this.state) || this.state.closing || this.finishing) return;
    this.options.adapter.prepare();
    this.hungUp = false;
    this.reply = null;
    this.dispatch({ type: "start" });
    void this.connect(this.status);
  }

  /** End the call the graceful way: tell the server, let it close, then close our side. */
  async hangUp(): Promise<void> {
    if (!inCall(this.state) || this.state.closing) return;
    this.hungUp = true;
    this.dispatch({ type: "closing" });
    const link = this.link;
    if (!link) return; // still connecting: connect() sees the closing state and stops
    link.send({ kind: "call.hangup" });
    await link.close();
    await this.finish();
  }

  toggleMute(): void {
    const muted = !this.state.muted;
    this.dispatch({ type: "mute", muted });
    this.link?.setMuted(muted);
  }

  /** Clear the "call ended" or failure notice. */
  dismiss(): void {
    this.dispatch({ type: "dismiss" });
  }

  dispose(): void {
    this.disposed = true;
    this.stopTimers();
    const link = this.link;
    this.link = null;
    if (link) {
      link.send({ kind: "call.hangup" });
      void link.close();
    } else {
      this.options.adapter.release();
    }
  }

  private async connect(status: VoiceStatus): Promise<void> {
    const { adapter, chat } = this.options;
    try {
      await adapter.openMic();
    } catch (err) {
      return this.fail(err instanceof MicError ? err.kind : "no-mic");
    }
    if (this.abandoned()) return;
    const conversationId = await chat.ensureConversation();
    if (!conversationId) return this.fail("unavailable");
    if (this.abandoned()) return;
    const preferred = this.options.transport;
    const transport = preferred && status.transports.includes(preferred) ? preferred : status.transports[0];
    const key = (this.options.newKey ?? randomKey)();
    try {
      const link = await adapter.connect({
        transport,
        baseUrl: this.options.baseUrl,
        iceServers: status.ice_servers ?? DEFAULT_ICE,
        start: (offer) => this.startCall({ conversation_id: conversationId, key, transport, ...(offer ? { offer } : {}) }),
        handlers: { onEvent: (e) => this.onEvent(e), onClosed: () => void this.finish() },
      });
      this.link = link;
      link.setMuted(this.state.muted);
      if (this.state.closing || this.disposed) {
        // The reader hung up while it connected.
        link.send({ kind: "call.hangup" });
        await link.close();
        await this.finish();
        return;
      }
      this.startTimers();
    } catch (err) {
      adapter.release();
      const kind = err instanceof StartError ? err.kind : "transport";
      if (kind === "unavailable") {
        this.status = null;
        this.dispatch({ type: "status", available: false });
      }
      this.fail(kind === "unavailable" ? "unavailable" : "transport");
    }
  }

  /** The reader hung up (or left) while the call was being set up. */
  private abandoned(): boolean {
    if (!this.state.closing && !this.disposed) return false;
    this.options.adapter.release();
    if (!this.disposed) this.dispatch({ type: "ended", reason: "hung_up" });
    return true;
  }

  /** POST /voice/calls, with one silent retry while the previous call is still closing. */
  private async startCall(body: Record<string, unknown>, retried = false): Promise<StartReply> {
    let res: Response;
    try {
      res = await this.fetch(`${this.options.baseUrl}/voice/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new StartError("transport");
    }
    if (res.status === 409 && !retried) {
      const wait = Math.min(Number(res.headers.get("Retry-After")) || 1, MAX_CLOSING_WAIT_S);
      await (this.options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait * 1000);
      return this.startCall(body, true);
    }
    if ([409, 429, 503].includes(res.status)) throw new StartError("unavailable");
    if (!res.ok) throw new StartError("transport");
    this.reply = (await res.json()) as StartReply;
    return this.reply;
  }

  private onEvent(event: VoiceEvent): void {
    if (event.kind === "call.ready") {
      this.dispatch({ type: "ready", callId: event.call_id, maxSeconds: event.max_seconds, now: this.now() });
      return;
    }
    this.dispatch({ type: "event", event, now: this.now() });
  }

  private startTimers(): void {
    this.stopTimers();
    this.timers.push(
      setInterval(() => {
        const link = this.link;
        if (!link) return;
        const { user, bot } = link.levels();
        this.dispatch({ type: "levels", user, bot, now: this.now() });
      }, LEVELS_MS),
      // The deadline is absolute, so a tab that was in the background catches up at once.
      setInterval(() => {
        this.dispatch({ type: "tick", now: this.now() });
        if (this.state.secondsLeft === 0 && inCall(this.state)) void this.hangUp();
      }, TICK_MS),
    );
  }

  private stopTimers(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  /** The connection is closed: work out how the call ended, then show the saved turns. */
  private finish(): Promise<void> {
    this.finishing ??= (async () => {
      this.stopTimers();
      this.link = null;
      let reason: EndReason | null = this.state.endReason;
      if (!reason && this.reply) reason = await this.readEndReason(this.reply.call_id);
      if (!reason && this.hungUp) reason = "hung_up";
      if (this.disposed) return;
      if (reason) this.dispatch({ type: "ended", reason });
      else this.dispatch({ type: "failed", failure: "transport" });
      await this.options.chat.reload();
      void this.checkStatus(); // the budgets may have changed
    })().finally(() => {
      this.finishing = null;
    });
    return this.finishing;
  }

  private async readEndReason(callId: string): Promise<EndReason | null> {
    try {
      const res = await this.fetch(`${this.options.baseUrl}/voice/calls/${callId}`, { cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json()) as { end_reason?: EndReason | null };
      return body.end_reason ?? null;
    } catch {
      return null;
    }
  }

  private fail(failure: VoiceFailure): void {
    this.stopTimers();
    this.options.adapter.release();
    if (!this.disposed) this.dispatch({ type: "failed", failure });
  }
}
