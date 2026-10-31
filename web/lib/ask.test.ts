import { describe, expect, it } from "vitest";
import { buildAskBody, MAX_ANSWER_CHARS, parseFrames, type PastTurn } from "@/lib/ask";

const turn = (n: number, status: PastTurn["status"] = "done"): PastTurn => ({
  question: `q${n}`,
  answer: `a${n}`,
  status,
});

describe("buildAskBody", () => {
  it("sends the question, track and provider with no history on the first turn", () => {
    expect(buildAskBody("What is RAG?", [], "ai-engineering", "ollama")).toEqual({
      question: "What is RAG?",
      history: [],
      track: "ai-engineering",
      provider: "ollama",
    });
  });

  it("keeps only the last six completed turns and skips errors and unfinished turns", () => {
    const turns = [1, 2, 3, 4, 5, 6, 7].map((n) => turn(n));
    turns.splice(3, 0, turn(99, "error"));
    turns.push(turn(100, "refused"), turn(101, "streaming"));
    const body = buildAskBody("next?", turns, null, "anthropic");
    expect(body.history.map((h) => h.question)).toEqual(["q3", "q4", "q5", "q6", "q7", "q100"]);
    expect(body.track).toBeNull();
  });

  it("cuts long answers to the API limit", () => {
    const long: PastTurn = { question: "q", answer: "x".repeat(5000), status: "done" };
    expect(buildAskBody("next?", [long], null, "ollama").history[0].answer).toHaveLength(
      MAX_ANSWER_CHARS,
    );
  });
});

describe("parseFrames", () => {
  it("returns complete events and keeps a partial frame for the next chunk", () => {
    const text =
      'data: {"type":"token","text":"Hi"}\n\n' +
      'data: {"type":"done","refused":false,"model":"m","top_similarity":0.8,"query":"q"}\n\n' +
      'data: {"type":"tok';
    const { events, rest } = parseFrames(text);
    expect(events).toEqual([
      { type: "token", text: "Hi" },
      { type: "done", refused: false, model: "m", top_similarity: 0.8, query: "q" },
    ]);
    expect(rest).toBe('data: {"type":"tok');
  });

  it("ignores frames without a data line", () => {
    expect(parseFrames(": keep-alive\n\n").events).toEqual([]);
  });
});
