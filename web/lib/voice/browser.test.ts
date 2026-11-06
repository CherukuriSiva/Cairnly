// The browser adapter's WebSocket path with fake browser objects: what it asks of the
// microphone, how it plays and drops the bot's audio, mute, and closing.

import { describe, expect, it, vi } from "vitest";
import { MicError } from "@/lib/voice/adapter";
import { browserVoiceAdapter, type BrowserDeps } from "@/lib/voice/browser";
import type { VoiceEvent } from "@/lib/voice/types";

/** Any Web Audio node: connect() chains, everything else is a no-op. */
function node(extra: Record<string, unknown> = {}) {
  const n: Record<string, unknown> = { connect: vi.fn(() => n), disconnect: vi.fn(), gain: { value: 1 }, ...extra };
  return n;
}

function fakes() {
  const started: number[] = [];
  const stopped: unknown[] = [];
  const sent: unknown[] = [];
  const port: { onmessage: ((e: { data: ArrayBuffer }) => void) | null } = { onmessage: null };
  const context = {
    currentTime: 10,
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    destination: node(),
    createMediaStreamDestination: () => node({ stream: { id: "out" } }),
    createMediaStreamSource: () => node(),
    createAnalyser: () => node({ fftSize: 0, getFloatTimeDomainData: (b: Float32Array) => b.fill(0.5) }),
    createGain: () => node(),
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createBuffer: (_c: number, length: number, rate: number) => ({ duration: length / rate, getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => {
      const source = node({ buffer: null, onended: null });
      source.start = (at: number) => started.push(at);
      source.stop = () => stopped.push(source);
      return source;
    },
  };
  const socket = {
    readyState: 0,
    binaryType: "",
    url: "",
    onopen: null as null | (() => void),
    onmessage: null as null | ((e: { data: unknown }) => void),
    onclose: null as null | (() => void),
    onerror: null as null | (() => void),
    send: (data: unknown) => sent.push(data),
    close: vi.fn(),
  };
  const track = { stop: vi.fn(), enabled: true };
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }));
  const audio = { srcObject: null, play: vi.fn(async () => {}) };
  const deps: Partial<BrowserDeps> = {
    getUserMedia: getUserMedia as unknown as BrowserDeps["getUserMedia"],
    createAudioContext: () => context as unknown as AudioContext,
    createSocket: (url) => ((socket.url = url), socket as unknown as WebSocket),
    createAudioElement: () => audio as unknown as HTMLAudioElement,
    workletUrl: vi.fn(() => "blob:capture"),
    revokeUrl: vi.fn(),
    createWorklet: () => node({ port }) as unknown as AudioWorkletNode,
  };
  const createAudioContext = vi.fn(() => context as unknown as AudioContext);
  deps.createAudioContext = createAudioContext;
  return { deps, context, socket, track, getUserMedia, audio, started, stopped, sent, port, createAudioContext };
}

describe("browserVoiceAdapter (WebSocket)", () => {
  it("unlocks audio synchronously and asks for an echo-cancelled microphone", async () => {
    const f = fakes();
    const adapter = browserVoiceAdapter(f.deps);
    adapter.prepare();
    expect(f.context.resume).toHaveBeenCalled();
    expect(f.audio.play).toHaveBeenCalled();
    await adapter.openMic();
    expect(f.getUserMedia).toHaveBeenCalledWith({ audio: expect.objectContaining({ echoCancellation: true, noiseSuppression: true }) });
  });

  it("maps a refused microphone to mic-denied", async () => {
    const f = fakes();
    const adapter = browserVoiceAdapter({ ...f.deps, getUserMedia: async () => Promise.reject(Object.assign(new Error("no"), { name: "NotAllowedError" })) });
    adapter.prepare();
    await expect(adapter.openMic()).rejects.toEqual(new MicError("mic-denied"));
  });

  it("streams the microphone, plays the bot in order, drops it on barge-in and closes", async () => {
    const f = fakes();
    const adapter = browserVoiceAdapter(f.deps);
    const events: VoiceEvent[] = [];
    const onClosed = vi.fn();
    adapter.prepare();
    await adapter.openMic();
    const linking = adapter.connect({
      transport: "websocket",
      baseUrl: "https://voice.test",
      start: async () => ({ call_id: "c", token: "t", transport: "websocket", max_seconds: 300, socket_path: "/voice/calls/c/socket?token=t" }),
      handlers: { onEvent: (e) => events.push(e), onClosed },
    });
    await vi.waitFor(() => expect(f.socket.onopen).not.toBeNull());
    expect(f.socket.url).toBe("wss://voice.test/voice/calls/c/socket?token=t");
    f.socket.readyState = 1;
    f.socket.onopen?.();
    const link = await linking;

    f.port.onmessage?.({ data: new ArrayBuffer(640) }); // 20 ms of microphone
    expect(f.sent).toHaveLength(1);
    link.setMuted(true);
    f.port.onmessage?.({ data: new ArrayBuffer(640) });
    expect(f.sent).toHaveLength(1); // muted: nothing leaves the browser

    const pcm = new Int16Array(2400).buffer; // 100 ms at 24 kHz
    f.socket.onmessage?.({ data: pcm });
    f.socket.onmessage?.({ data: pcm });
    expect(f.started[0]).toBeCloseTo(10.06);
    expect(f.started[1]).toBeCloseTo(10.16); // queued right after the first chunk
    f.socket.onmessage?.({ data: '{"kind":"audio.clear"}' });
    expect(f.stopped).toHaveLength(2);
    expect(events).toEqual([{ kind: "audio.clear" }]);
    expect(link.levels().bot).toBeCloseTo(0.5);

    const closing = link.close();
    f.socket.onclose?.(); // the server closes after its call.closed
    await closing;
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(f.track.stop).toHaveBeenCalled(); // the microphone is released
  });
});

/** One WebSocket call on `adapter`, from the click to the open socket, then hung up. */
async function oneCall(adapter: ReturnType<typeof browserVoiceAdapter>, f: ReturnType<typeof fakes>) {
  adapter.prepare();
  await adapter.openMic();
  f.socket.onopen = null;
  f.socket.readyState = 0;
  const linking = adapter.connect({
    transport: "websocket",
    baseUrl: "https://voice.test",
    start: async () => ({ call_id: "c", token: "t", transport: "websocket", max_seconds: 300, socket_path: "/voice/calls/c/socket?token=t" }),
    handlers: { onEvent: () => {}, onClosed: () => {} },
  });
  await vi.waitFor(() => expect(f.socket.onopen).not.toBeNull());
  f.socket.readyState = 1;
  (f.socket.onopen as null | (() => void))?.(); // set again by connect()
  const link = await linking;
  const closing = link.close();
  f.socket.onclose?.();
  await closing;
}

describe("browserVoiceAdapter (resources)", () => {
  it("adds the capture module once per audio context and revokes its Blob URL", async () => {
    const f = fakes();
    const adapter = browserVoiceAdapter(f.deps);
    await oneCall(adapter, f);
    await oneCall(adapter, f);
    expect(f.context.audioWorklet.addModule).toHaveBeenCalledTimes(1);
    expect(f.deps.workletUrl).toHaveBeenCalledTimes(1);
    expect(f.deps.revokeUrl).toHaveBeenCalledWith("blob:capture");
  });

  it("closes the audio context when the page goes away; a new one loads the module again", async () => {
    const f = fakes();
    const adapter = browserVoiceAdapter(f.deps);
    await oneCall(adapter, f);
    adapter.dispose();
    expect(f.context.close).toHaveBeenCalledTimes(1);
    expect(f.audio.srcObject).toBeNull();
    await oneCall(adapter, f);
    expect(f.createAudioContext).toHaveBeenCalledTimes(2);
    expect(f.context.audioWorklet.addModule).toHaveBeenCalledTimes(2);
  });
});
