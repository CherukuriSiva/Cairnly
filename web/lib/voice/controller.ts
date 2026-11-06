// Drives a voice call: starts one inside the reader's click, feeds the state machine (events,
// audio levels, the clock), hangs up gracefully, then reloads the saved conversation so the
// spoken turns show as normal messages. No React: the page subscribes to it
// (useSyncExternalStore), and tests run it with a fake adapter and a fake fetch.
//
// The voice server runs on a GPU that sleeps when nobody calls, and any request to it wakes it.
// So nothing is sent to it until the reader clicks the microphone: the first click asks for its
// status (once per page) and starts the call, showing "Waking the voice model" with the seconds
// it takes. A refusal hides the microphone with one neutral line.

import { inCall, initialVoiceState, showMic, voiceReducer, type VoiceAction } from "@/lib/voice/machine";
import { MicError, type VoiceAdapter, type VoiceLink } from "@/lib/voice/adapter";
import type { EndReason, StartReply, Transport, VoiceEvent, VoiceFailure, VoiceState, VoiceStatus } from "@/lib/voice/types";

/** The voice server; unset (the default) means no voice mode at all. */
export const VOICE_URL = (process.env.NEXT_PUBLIC_VOICE_URL ?? "").replace(/\/$/, "");

export const LEVELS_MS = 100;
export const TICK_MS = 1_000;
// At zero the server says a short goodbye and closes the call itself; the browser hangs up
// on its own only if the call is still open this long after the deadline.
export const DEADLINE_GRACE_MS = 5_000;
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
  private abort: AbortController | null = null; // cancels the setup's requests on a hang-up

  constructor(private readonly options: VoiceControllerOptions) {}

  getState = (): VoiceState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** fetch, never called as a method of this object (browsers refuse that: Illegal invocation). */
  private get fetch(): typeof fetch {
    return this.options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
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

  /** The page has loaded and can offer voice (the API saves conversations): the mic shows.
   * Nothing is sent to the voice server here; that waits for a click. */
  offer(offered: boolean): void {
    this.dispatch({ type: "offer", offered });
  }

  /** GET /voice/status, after a click only (it wakes the GPU). Anything but a clear
   * "available" with a transport is no. */
  private async fetchStatus(): Promise<VoiceStatus | null> {
    try {
      const res = await this.fetch(`${this.options.baseUrl}/voice/status`, { cache: "no-store", signal: this.abort?.signal });
      const body = res.ok ? ((await res.json()) as Partial<VoiceStatus>) : null;
      if (body?.available === true && Array.isArray(body.transports) && body.transports.length > 0) return body as VoiceStatus;
    } catch {
      // unreachable: the same as "not now"
    }
    return null;
  }

  /** Start a call. Call it synchronously from the click handler: the audio is unlocked here,
   * before anything is awaited. */
  start(): void {
    if (!showMic(this.state) || this.finishing) return;
    this.options.adapter.prepare();
    this.hungUp = false;
    this.reply = null;
    this.abort = new AbortController();
    this.dispatch({ type: "start" });
    void this.connect();
  }

  /** End the call the graceful way: tell the server, let it close, then close our side. */
  async hangUp(): Promise<void> {
    if (!inCall(this.state) || this.state.closing) return;
    this.hungUp = true;
    this.dispatch({ type: "closing" });
    const link = this.link;
    if (!link) {
      // Still connecting (the GPU may take a minute to wake): drop its requests now, and
      // connect() sees the closing state and stops.
      this.abort?.abort();
      return;
    }
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
    this.abort?.abort();
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

  private async connect(): Promise<void> {
    const { adapter, chat } = this.options;
    try {
      await adapter.openMic();
    } catch (err) {
      return this.fail(err instanceof MicError ? err.kind : "no-mic");
    }
    if (this.abandoned()) return;
    // From here on the voice server is asked, which wakes its GPU if it sleeps: count the seconds
    // until it answers the start. Its status is asked once per page, not before every call.
    this.dispatch({ type: "waking", now: this.now() });
    this.startTimers();
    const status = this.status ?? (await this.fetchStatus());
    if (this.abandoned()) return;
    if (!status) return this.refused();
    this.status = status;
    this.dispatch({ type: "status", available: true });
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
      if (this.abandoned()) return;
      const kind = err instanceof StartError ? err.kind : "transport";
      if (kind === "unavailable") return this.refused();
      this.fail("transport");
    }
  }

  /** Voice said no (off, busy, a limit) or could not be reached: hide the mic, say so once. */
  private refused(): void {
    this.status = null;
    if (!this.disposed) this.dispatch({ type: "status", available: false, said: true });
    this.fail("unavailable");
  }

  /** The reader hung up (or left) while the call was being set up. */
  private abandoned(): boolean {
    if (!this.state.closing && !this.disposed) return false;
    this.stopTimers();
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
        signal: this.abort?.signal,
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
    this.dispatch({ type: "woke" });
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
        const now = this.now();
        this.dispatch({ type: "tick", now });
        const { deadline } = this.state;
        if (deadline !== null && now >= deadline + DEADLINE_GRACE_MS && inCall(this.state)) void this.hangUp();
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
      // No status check here: it could keep the GPU awake. A next call that is refused says so.
      await this.options.chat.reload();
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
