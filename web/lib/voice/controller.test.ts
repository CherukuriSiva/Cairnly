import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MicError, parseVoiceEvent, type ConnectOptions, type VoiceAdapter, type VoiceLink } from "@/lib/voice/adapter";
import { VoiceController } from "@/lib/voice/controller";
import type { VoiceEvent } from "@/lib/voice/types";

const BASE = "http://voice.test";
const CID = "0b6f3a52-6a0e-4d3c-9f1e-2b8d7c6a5e4f";
const STATUS = { available: true, reason: null, max_call_seconds: 300, transports: ["websocket", "webrtc"], half_duplex: false };
const REPLY = { call_id: "call-1", token: "t".repeat(12), transport: "websocket", max_seconds: 300, socket_path: "/voice/calls/call-1/socket?token=x" };

type Route = (init?: RequestInit) => Response | Promise<Response>;

/** A fetch that answers per "METHOD path" and records the calls. */
function fakeFetch(routes: Record<string, Route | Route[]>) {
  const calls: { key: string; body?: unknown }[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).replace(BASE, "")}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes[key];
    const handler = Array.isArray(route) ? route.shift() : route;
    if (!handler) throw new TypeError("network down");
    return handler(init);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** An adapter with a scriptable link; `emit` plays server events, `drop` closes from the far side. */
function fakeAdapter({ mic = "ok" as "ok" | "mic-denied" | "no-mic" } = {}) {
  const log: string[] = [];
  let options: ConnectOptions | null = null;
  let level = { user: 0, bot: 0 };
  const link: VoiceLink = {
    send: (m) => log.push(`send ${m.kind}`),
    setMuted: (m) => log.push(`muted ${m}`),
    levels: () => level,
    close: async () => {
      log.push("close");
      options?.handlers.onClosed();
    },
  };
  const adapter: VoiceAdapter = {
    prepare: () => log.push("prepare"),
    openMic: async () => {
      log.push("mic");
      if (mic !== "ok") throw new MicError(mic);
    },
    connect: async (o) => {
      options = o;
      log.push(`connect ${o.transport}`);
      await o.start();
      return link;
    },
    release: () => log.push("release"),
  };
  return {
    adapter,
    log,
    emit: (event: VoiceEvent) => options?.handlers.onEvent(event),
    drop: () => options?.handlers.onClosed(),
    setLevel: (l: typeof level) => (level = l),
  };
}

function chat(id: string | null = CID) {
  const calls: string[] = [];
  return {
    calls,
    chat: {
      ensureConversation: async () => (calls.push("ensure"), id),
      reload: async () => void calls.push("reload"),
    },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("VoiceController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("hides the mic unless the server clearly says available", async () => {
    for (const route of [() => json({ ...STATUS, available: false }), () => json({}, 500), () => json({ ...STATUS, transports: [] })]) {
      const v = new VoiceController({ baseUrl: BASE, adapter: fakeAdapter().adapter, chat: chat().chat, fetchImpl: fakeFetch({ "GET /voice/status": route }).impl });
      expect(await v.checkStatus()).toBe(false);
      expect(v.getState().available).toBe(false);
    }
    const down = new VoiceController({ baseUrl: BASE, adapter: fakeAdapter().adapter, chat: chat().chat, fetchImpl: fakeFetch({}).impl });
    expect(await down.checkStatus()).toBe(false);
  });

  it("runs a whole call: prepare in the click, captions, countdown, hang-up, reload", async () => {
    const f = fakeFetch({
      "GET /voice/status": () => json(STATUS),
      "POST /voice/calls": () => json(REPLY),
      "GET /voice/calls/call-1": () => json({ end_reason: "hung_up" }),
    });
    const a = fakeAdapter();
    const c = chat();
    let now = 0;
    const v = new VoiceController({ baseUrl: BASE, adapter: a.adapter, chat: c.chat, fetchImpl: f.impl, now: () => now, newKey: () => "key-12345678" });
    await v.checkStatus();
    v.start();
    expect(a.log[0]).toBe("prepare"); // before anything was awaited
    expect(v.getState().phase).toBe("connecting");
    await flush();
    expect(c.calls).toEqual(["ensure"]);
    expect(f.calls[1]).toEqual({ key: "POST /voice/calls", body: { conversation_id: CID, key: "key-12345678", transport: "websocket" } });

    a.emit({ kind: "call.ready", call_id: "call-1", max_seconds: 300 });
    expect(v.getState().phase).toBe("greeting");
    a.emit({ kind: "caption.user", text: "What is RAG?" });
    expect(v.getState()).toMatchObject({ phase: "thinking", userCaption: "What is RAG?" });
    a.setLevel({ user: 0, bot: 0.3 });
    a.emit({ kind: "caption.bot", text: "RAG retrieves first." });
    a.emit({ kind: "turn.saved", message_id: 9 });
    now = 1_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(v.getState()).toMatchObject({ phase: "speaking", secondsLeft: 299, savedIds: [9] });

    await v.hangUp();
    expect(a.log.slice(-2)).toEqual(["send call.hangup", "close"]);
    expect(v.getState()).toMatchObject({ phase: "ended", endReason: "hung_up" });
    expect(c.calls).toEqual(["ensure", "reload"]);
  });

  it("hangs up at zero, from the deadline it was given", async () => {
    const f = fakeFetch({ "GET /voice/status": () => json(STATUS), "POST /voice/calls": () => json(REPLY), "GET /voice/calls/call-1": () => json({ end_reason: "max_duration" }) });
    const a = fakeAdapter();
    let now = 0;
    const v = new VoiceController({ baseUrl: BASE, adapter: a.adapter, chat: chat().chat, fetchImpl: f.impl, now: () => now });
    await v.checkStatus();
    v.start();
    await flush();
    a.emit({ kind: "call.ready", call_id: "call-1", max_seconds: 40 });
    expect(v.getState().endingSoon).toBe(false);
    now = 10_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(v.getState()).toMatchObject({ endingSoon: true, secondsLeft: 30 });
    now = 40_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(a.log).toContain("send call.hangup");
    expect(v.getState()).toMatchObject({ phase: "ended", endReason: "max_duration" });
  });

  it("uses the server's end reason when the server ends the call", async () => {
    const f = fakeFetch({ "GET /voice/status": () => json(STATUS), "POST /voice/calls": () => json(REPLY) });
    const a = fakeAdapter();
    const c = chat();
    const v = new VoiceController({ baseUrl: BASE, adapter: a.adapter, chat: c.chat, fetchImpl: f.impl });
    await v.checkStatus();
    v.start();
    await flush();
    a.emit({ kind: "call.ready", call_id: "call-1", max_seconds: 300 });
    a.emit({ kind: "call.closed", reason: "farewell" });
    a.drop();
    await flush();
    expect(v.getState()).toMatchObject({ phase: "ended", endReason: "farewell" });
    expect(c.calls).toContain("reload");
  });

  it("a dropped connection with no reason is a transport failure", async () => {
    const f = fakeFetch({ "GET /voice/status": () => json(STATUS), "POST /voice/calls": () => json(REPLY), "GET /voice/calls/call-1": () => json({ end_reason: null }) });
    const a = fakeAdapter();
    const v = new VoiceController({ baseUrl: BASE, adapter: a.adapter, chat: chat().chat, fetchImpl: f.impl });
    await v.checkStatus();
    v.start();
    await flush();
    a.drop();
    await flush();
    expect(v.getState()).toMatchObject({ phase: "failed", failure: "transport" });
  });

  it("mic denied: a clear notice, nothing started", async () => {
    const f = fakeFetch({ "GET /voice/status": () => json(STATUS) });
    const a = fakeAdapter({ mic: "mic-denied" });
    const v = new VoiceController({ baseUrl: BASE, adapter: a.adapter, chat: chat().chat, fetchImpl: f.impl });
    await v.checkStatus();
    v.start();
    await flush();
    expect(v.getState()).toMatchObject({ phase: "failed", failure: "mic-denied" });
    expect(f.calls.map((c) => c.key)).toEqual(["GET /voice/status"]);
    expect(a.log).toContain("release");
  });

  it("retries once, silently, while the last call is closing; a limit hides the mic", async () => {
    const f = fakeFetch({
      "GET /voice/status": () => json(STATUS),
      "POST /voice/calls": [() => json({ detail: "closing" }, 409, { "Retry-After": "1" }), () => json(REPLY)],
    });
    const a = fakeAdapter();
    const v = new VoiceController({ baseUrl: BASE, adapter: a.adapter, chat: chat().chat, fetchImpl: f.impl, sleep: async () => {}, newKey: () => "key-same-1" });
    await v.checkStatus();
    v.start();
    await flush();
    const starts = f.calls.filter((c) => c.key === "POST /voice/calls");
    expect(starts).toHaveLength(2);
    expect(starts[0].body).toEqual(starts[1].body); // the same idempotency key
    expect(v.getState().phase).toBe("connecting");

    const g = fakeFetch({ "GET /voice/status": () => json(STATUS), "POST /voice/calls": () => json({ detail: "x" }, 503, { "Retry-After": "30" }) });
    const w = new VoiceController({ baseUrl: BASE, adapter: fakeAdapter().adapter, chat: chat().chat, fetchImpl: g.impl });
    await w.checkStatus();
    w.start();
    await flush();
    expect(w.getState()).toMatchObject({ phase: "failed", failure: "unavailable", available: false });
  });

  it("no saved conversation (an older API): voice is unavailable", async () => {
    const f = fakeFetch({ "GET /voice/status": () => json(STATUS) });
    const v = new VoiceController({ baseUrl: BASE, adapter: fakeAdapter().adapter, chat: chat(null).chat, fetchImpl: f.impl });
    await v.checkStatus();
    v.start();
    await flush();
    expect(v.getState()).toMatchObject({ phase: "failed", failure: "unavailable" });
  });

  it("prefers the transport it is asked for, if the server offers it", async () => {
    const f = fakeFetch({ "GET /voice/status": () => json(STATUS), "POST /voice/calls": () => json(REPLY) });
    const a = fakeAdapter();
    const v = new VoiceController({ baseUrl: BASE, adapter: a.adapter, chat: chat().chat, fetchImpl: f.impl, transport: "webrtc" });
    await v.checkStatus();
    v.start();
    await flush();
    expect(a.log).toContain("connect webrtc");
  });

  it("mute is passed to the link", async () => {
    const f = fakeFetch({ "GET /voice/status": () => json(STATUS), "POST /voice/calls": () => json(REPLY) });
    const a = fakeAdapter();
    const v = new VoiceController({ baseUrl: BASE, adapter: a.adapter, chat: chat().chat, fetchImpl: f.impl });
    await v.checkStatus();
    v.start();
    await flush();
    v.toggleMute();
    expect(v.getState().muted).toBe(true);
    expect(a.log).toContain("muted true");
  });
});

describe("parseVoiceEvent", () => {
  it("accepts known events and drops anything else", () => {
    expect(parseVoiceEvent('{"kind":"caption.bot","text":"Hi","holding":true}')).toEqual({ kind: "caption.bot", text: "Hi", holding: true });
    expect(parseVoiceEvent('{"kind":"turn.saved","message_id":"7"}')).toBeNull();
    expect(parseVoiceEvent('{"kind":"something.new"}')).toBeNull();
    expect(parseVoiceEvent("not json")).toBeNull();
    expect(parseVoiceEvent({ kind: "audio.clear", extra: 1 })).toEqual({ kind: "audio.clear" });
  });
});
