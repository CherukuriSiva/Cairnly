import { describe, expect, it } from "vitest";
import type { AskEvent } from "@/lib/ask";
import { chatReducer, groupTurns, initialChatState, NO_ANSWER, pastTurns, type ChatAction } from "@/lib/chat/reducer";
import type { AssistantRow, ChatState, ErrorRow } from "@/lib/chat/types";

const SOURCE = { n: 1, title: "RAG", trail: "Idea", path: "lessons/rag.mdx", lines: [1, 4] as [number, number], citation: "RAG > Idea", url: "/ai/rag#idea" };
const DONE: AskEvent = { type: "done", refused: false, model: "ollama/qwen3:8b", top_similarity: 0.86, query: "What is RAG?" };

function run(actions: ChatAction[], state: ChatState = initialChatState): ChatState {
  return actions.reduce(chatReducer, state);
}
const ev = (event: AskEvent): ChatAction => ({ type: "event", event });
const send = (key = "t1", text = "What is RAG?"): ChatAction => ({ type: "send", key, text, scope: null });
const answerOf = (s: ChatState) => s.rows.find((r) => r.kind === "assistant") as AssistantRow | undefined;
const errorOf = (s: ChatState) => s.rows.find((r) => r.kind === "error") as ErrorRow | undefined;

describe("chatReducer", () => {
  it("goes idle → thinking → streaming → idle through one answer", () => {
    let s = run([send()]);
    expect(s.status).toBe("thinking");
    expect(s.pending).toBe("t1");
    s = run([ev({ type: "sources", sources: [SOURCE] })], s);
    expect(s.status).toBe("thinking");
    expect(answerOf(s)).toMatchObject({ live: true, text: "", sources: [SOURCE] });
    s = run([ev({ type: "token", text: "Retrieve " }), ev({ type: "token", text: "then generate [1]." })], s);
    expect(s.status).toBe("streaming");
    expect(answerOf(s)?.text).toBe("Retrieve then generate [1].");
    s = run([ev(DONE)], s);
    expect(s).toMatchObject({ status: "idle", pending: null });
    expect(answerOf(s)).toMatchObject({ live: false, model: "ollama/qwen3:8b", topSimilarity: 0.86 });
    expect(answerOf(s)?.searched).toBeUndefined(); // the query is the question
  });

  it("takes the final event's text as the truth and attaches the saved message id", () => {
    const s = run([send(), ev({ type: "token", text: "Retrive" }), ev({ ...DONE, text: "Retrieve.", message_id: 7 } as AskEvent)]);
    expect(answerOf(s)).toMatchObject({ text: "Retrieve.", messageId: 7, vote: null });
  });

  it("keeps the streamed text when an older API sends no final text, and no vote state", () => {
    const s = run([send(), ev({ type: "token", text: "Retrieve." }), ev(DONE)]);
    expect(answerOf(s)).toMatchObject({ text: "Retrieve.", messageId: undefined, vote: undefined });
  });

  it("announces each finished answer once, as plain text", () => {
    const s = run([send(), ev({ type: "token", text: "**RAG** retrieves [1]." }), ev(DONE)]);
    expect(s.announcement).toEqual({ id: 1, text: "Cairnly answered: RAG retrieves." });
    const again = run([ev({ type: "token", text: "late" })], s); // nothing pending: ignored
    expect(again).toBe(s);
  });

  it("drops an answer bubble that closes with no text and shows a card instead", () => {
    const s = run([send(), ev({ type: "sources", sources: [] }), ev(DONE)]);
    expect(answerOf(s)).toBeUndefined();
    expect(errorOf(s)).toMatchObject({ failure: "ended", message: NO_ANSWER, retrying: false });
    expect(s.status).toBe("idle");
  });

  it("an error with no text drops the empty bubble; with text it keeps a cut answer", () => {
    const empty = run([send(), ev({ type: "sources", sources: [SOURCE] }), ev({ type: "error", message: "Boom" })]);
    expect(answerOf(empty)).toBeUndefined();
    expect(errorOf(empty)).toMatchObject({ failure: "answer", message: "Boom" });
    const partial = run([send(), ev({ type: "token", text: "Half" }), ev({ type: "error", message: "Boom" })]);
    expect(answerOf(partial)).toMatchObject({ text: "Half", live: false, cut: true });
    expect(partial.rows.map((r) => r.kind)).toEqual(["user", "assistant", "error"]);
  });

  it("a withdrawn answer shows the safety message and counts as refused", () => {
    const s = run([send(), ev({ type: "token", text: "secret" }), ev({ type: "retract", message: "Withdrawn." }), ev({ ...DONE, refused: true, guard: "prompt_leak" })]);
    expect(answerOf(s)).toMatchObject({ text: "Withdrawn.", refused: true, guard: "prompt_leak" });
  });

  it("an automatic retry keeps the turn busy; a resend clears the card and asks again", () => {
    let s = run([send(), { type: "failed", failure: "waking", message: "503", retrying: true }]);
    expect(s).toMatchObject({ status: "thinking", pending: "t1" });
    expect(errorOf(s)).toMatchObject({ retrying: true, attempt: 1 });
    expect(s.announcement).toBeNull(); // not announced while it retries by itself
    s = run([{ type: "resend", replyTo: "t1" }], s);
    expect(errorOf(s)).toBeUndefined();
    expect(s.rows[0]).toMatchObject({ kind: "user", attempt: 2 });
    s = run([ev({ type: "token", text: "ok" }), ev(DONE)], s);
    expect(answerOf(s)?.key).toBe("t1:a2");
  });

  it("Stop during a scheduled retry leaves the card without the retrying note", () => {
    const s = run([send(), { type: "failed", failure: "network", message: "x", retrying: true }, { type: "retry-cancelled" }]);
    expect(s).toMatchObject({ status: "idle", pending: null });
    expect(errorOf(s)?.retrying).toBe(false);
  });

  it("retries an older failed question in its place", () => {
    let s = run([send("t1", "q1"), { type: "failed", failure: "http", message: "500" }, send("t2", "q2"), ev({ type: "token", text: "a2" }), ev(DONE)]);
    s = run([{ type: "resend", replyTo: "t1" }, ev({ type: "token", text: "a1" }), ev(DONE)], s);
    expect(s.rows.map((r) => (r.kind === "user" ? r.text : r.kind === "assistant" ? r.text : "error"))).toEqual(["q1", "a1", "q2", "a2"]);
  });

  it("ignores a second send while one is in flight", () => {
    const s = run([send("t1"), send("t2")]);
    expect(s.rows).toHaveLength(1);
  });

  it("waking is noted (and announced) once", () => {
    const s = run([send(), { type: "waking" }, { type: "waking" }]);
    expect(s.waking).toBe(true);
    expect(s.announcement?.id).toBe(1);
    expect(run([ev({ type: "token", text: "a" })], s).waking).toBe(false);
  });

  it("restores saved rows and votes on a saved answer", () => {
    const restored: AssistantRow = { kind: "assistant", key: "m2", replyTo: "m1", text: "a", live: false, channel: "text", sources: [], messageId: 2, vote: null, restored: true };
    let s = run([{ type: "restore", rows: [{ kind: "user", key: "m1", text: "q", channel: "text", scope: null, attempt: 1 }, restored] }]);
    s = run([{ type: "vote", messageId: 2, vote: "up" }], s);
    expect(answerOf(s)?.vote).toBe("up");
    expect(run([{ type: "reset" }], s).rows).toEqual([]);
  });

  it("keeps the channel of a voice question on its answer", () => {
    const s = run([{ type: "send", key: "t1", text: "q", scope: null, channel: "voice" }, ev({ type: "token", text: "a" }), ev(DONE)]);
    expect(answerOf(s)?.channel).toBe("voice");
  });
});

describe("pastTurns", () => {
  it("lists finished turns before a question, skipping cut answers and errors", () => {
    const s = run([
      send("t1", "q1"),
      ev({ type: "token", text: "a1" }),
      ev(DONE),
      send("t2", "q2"),
      ev({ type: "token", text: "half" }),
      ev({ type: "error", message: "x" }),
      send("t3", "q3"),
      ev({ type: "token", text: "No." }),
      ev({ ...DONE, refused: true, guard: "injection" }),
      send("t4", "q4"),
    ]);
    expect(pastTurns(s.rows, "t4")).toEqual([
      { question: "q1", answer: "a1", status: "done", guard: undefined },
      { question: "q3", answer: "No.", status: "refused", guard: "injection" },
    ]);
    expect(pastTurns(s.rows, "t2")).toHaveLength(1);
  });
});

describe("groupTurns", () => {
  it("groups replies under their question", () => {
    const s = run([send("t1", "q1"), ev({ type: "token", text: "a1" }), ev(DONE), send("t2", "q2")]);
    expect(groupTurns(s.rows).map((g) => [g.question.text, g.replies.length])).toEqual([
      ["q1", 1],
      ["q2", 0],
    ]);
  });
});
