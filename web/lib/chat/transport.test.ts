import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAskBody, TIMEOUT_MESSAGE } from "@/lib/ask";
import { liveTransport, TransportError } from "@/lib/chat/transport";

const body = buildAskBody("q", [], null, "4f2c9a1e-1b2c-4d5e-8f90-123456789abc");
const encoder = new TextEncoder();

/** A response whose body is fed by the test, chunk by chunk. */
function streamed() {
  let push!: (text: string) => void;
  let end!: () => void;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (text) => controller.enqueue(encoder.encode(text));
      end = () => controller.close();
    },
  });
  return { response: new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }), push: (t: string) => push(t), end: () => end() };
}

const run = (transport = liveTransport("http://api"), signal = new AbortController().signal) => {
  const data: string[] = [];
  const done = transport.send(body, (d) => data.push(d), signal);
  return { data, done };
};

describe("liveTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("hands each frame's data over as it arrives, across chunk boundaries", async () => {
    const s = streamed();
    vi.stubGlobal("fetch", async () => s.response);
    const { data, done } = run();
    s.push('data: {"type":"sources","sources":[]}\n\ndata: {"type":"tok');
    s.push('en","text":"Hi"}\n\n');
    s.end();
    await done;
    expect(data).toEqual(['{"type":"sources","sources":[]}', '{"type":"token","text":"Hi"}']);
  });

  it("turns HTTP errors into failures with the status and Retry-After", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ detail: "Too many." }), { status: 429, headers: { "Retry-After": "7" } }));
    const error = await run().done.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ kind: "rate", status: 429, retryAfterS: 7 });
    expect((error as Error).message).toContain("7 seconds");
  });

  it("a 503 is waking, a 404 is gone, a failed fetch is network", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ detail: "Starting" }), { status: 503 }));
    await expect(run().done).rejects.toMatchObject({ kind: "waking", message: "Starting" });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ detail: "Conversation not found." }), { status: 404 }));
    await expect(run().done).rejects.toMatchObject({ kind: "gone", status: 404 });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(run().done).rejects.toMatchObject({ kind: "network" });
  });

  it("times out when no response headers arrive in time", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const pending = liveTransport("http://api", { headerTimeoutMs: 5000 })
      .send(body, () => {}, new AbortController().signal)
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ kind: "timeout", message: TIMEOUT_MESSAGE });
  });

  it("fails a stream that goes quiet once the answer started; every byte restarts the timer", async () => {
    vi.useFakeTimers();
    const s = streamed();
    vi.stubGlobal("fetch", async () => s.response);
    const { data, done } = run(liveTransport("http://api", { stallMs: 1000, firstTokenStallMs: 10_000 }));
    const result = done.catch((e: unknown) => e);
    s.push('data: {"type":"sources","sources":[]}\n\n');
    await vi.advanceTimersByTimeAsync(5000); // before the first token: the long limit applies
    s.push('data: {"type":"token","text":"a"}\n\n');
    await vi.advanceTimersByTimeAsync(900);
    s.push('data: {"type":"token","text":"b"}\n\n');
    await vi.advanceTimersByTimeAsync(900); // 1.8 s since "a", but only 0.9 s since "b"
    expect(data).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toMatchObject({ kind: "stall" });
  });

  it("a Stop surfaces as the browser's AbortError, not a failure", async () => {
    const s = streamed();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      init.signal?.addEventListener("abort", () => s.response.body?.cancel().catch(() => {}));
      return s.response;
    });
    const stop = new AbortController();
    const { done } = run(liveTransport("http://api"), stop.signal);
    s.push('data: {"type":"token","text":"a"}\n\n');
    await new Promise((r) => setTimeout(r, 0));
    stop.abort();
    s.end();
    const outcome = await done.then(
      () => "ended",
      (e: unknown) => e,
    );
    // Depending on timing the reader sees the end or the abort; it is never a TransportError.
    expect(outcome instanceof TransportError).toBe(false);
  });
});
