import { describe, expect, it } from "vitest";
import { parseEvent, splitFrames } from "@/lib/chat/events";

const SOURCE = { n: 1, title: "RAG", trail: "Idea", path: "lessons/rag.mdx", lines: [1, 4], citation: "RAG > Idea", url: "/ai/rag#idea" };

describe("splitFrames", () => {
  it("returns complete frames' data and keeps a partial frame for the next chunk", () => {
    const { data, rest } = splitFrames('data: {"type":"token","text":"Hi"}\n\ndata: {"type":"tok');
    expect(data).toEqual(['{"type":"token","text":"Hi"}']);
    expect(rest).toBe('data: {"type":"tok');
  });

  it("drops comment frames and accepts CRLF line ends", () => {
    expect(splitFrames(': keep-alive\n\ndata: {"type":"token","text":"a"}\r\n\r\n').data).toEqual(['{"type":"token","text":"a"}']);
  });
});

describe("parseEvent", () => {
  it("accepts every event the API sends", () => {
    expect(parseEvent(JSON.stringify({ type: "sources", sources: [SOURCE] }))).toEqual({ kind: "ok", event: { type: "sources", sources: [SOURCE] } });
    expect(parseEvent('{"type":"token","text":"Hi"}')).toEqual({ kind: "ok", event: { type: "token", text: "Hi" } });
    expect(parseEvent('{"type":"retract","message":"Withdrawn."}')).toMatchObject({ kind: "ok", event: { type: "retract" } });
    expect(parseEvent('{"type":"error","message":"Boom"}')).toMatchObject({ kind: "ok", event: { type: "error", message: "Boom" } });
  });

  it("reads done from an older API (no text, no id) and from a newer one", () => {
    const old = parseEvent('{"type":"done","refused":false,"model":"m","top_similarity":0.8,"query":"q","guard":null,"uncited":false}');
    expect(old).toMatchObject({ kind: "ok", event: { type: "done", refused: false, text: undefined, message_id: undefined } });
    const newer = parseEvent('{"type":"done","refused":true,"model":"m","top_similarity":0.1,"query":"q","guard":"injection","text":"No.","message_id":42}');
    expect(newer).toMatchObject({ kind: "ok", event: { type: "done", refused: true, guard: "injection", text: "No.", message_id: 42 } });
  });

  it("fills a source without a url with an empty one", () => {
    const { url: _url, ...noUrl } = SOURCE;
    const parsed = parseEvent(JSON.stringify({ type: "sources", sources: [noUrl] }));
    expect(parsed).toMatchObject({ kind: "ok", event: { sources: [{ url: "" }] } });
  });

  it("skips unknown event types instead of failing", () => {
    expect(parseEvent('{"type":"progress","step":"retrieve"}')).toEqual({ kind: "unknown", type: "progress" });
  });

  it("marks malformed frames invalid", () => {
    expect(parseEvent("not json")).toMatchObject({ kind: "invalid" });
    expect(parseEvent("[1,2]")).toMatchObject({ kind: "invalid" });
    expect(parseEvent('{"text":"no type"}')).toMatchObject({ kind: "invalid" });
    expect(parseEvent('{"type":"token","text":5}')).toMatchObject({ kind: "invalid", reason: "token" });
    expect(parseEvent('{"type":"sources","sources":[{"n":"1"}]}')).toMatchObject({ kind: "invalid", reason: "sources" });
    expect(parseEvent('{"type":"done","refused":"no"}')).toMatchObject({ kind: "invalid", reason: "done" });
    expect(parseEvent('{"type":"done","refused":false,"message_id":-3}')).toMatchObject({ kind: "invalid", reason: "done" });
  });
});
