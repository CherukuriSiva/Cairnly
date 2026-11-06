import { describe, expect, it } from "vitest";
import { clockText, ENDING_NOTICE_S, inCall, initialVoiceState, phaseLabel, showMic, SPEAKING_HOLD_MS, voiceReducer, type VoiceAction } from "@/lib/voice/machine";
import type { VoiceState } from "@/lib/voice/types";

const run = (actions: VoiceAction[], from: VoiceState = initialVoiceState) => actions.reduce(voiceReducer, from);
const connected = (now = 0) => run([{ type: "status", available: true }, { type: "start" }, { type: "ready", callId: "c1", maxSeconds: 300, now }]);
const quiet = (now: number): VoiceAction => ({ type: "levels", user: 0, bot: 0, now });
const loud = (now: number): VoiceAction => ({ type: "levels", user: 0, bot: 0.2, now });

describe("voiceReducer", () => {
  it("goes idle -> connecting -> greeting -> listening once the greeting is over", () => {
    let s = run([{ type: "status", available: true }, { type: "start" }]);
    expect(s.phase).toBe("connecting");
    s = voiceReducer(s, { type: "ready", callId: "c1", maxSeconds: 300, now: 1_000 });
    expect(s).toMatchObject({ phase: "greeting", callId: "c1", deadline: 301_000, secondsLeft: 300 });
    expect(voiceReducer(s, quiet(1_050)).phase).toBe("greeting"); // the greeting has not sounded yet
    s = run([{ type: "event", event: { kind: "caption.bot", text: "Hi" }, now: 1_100 }, loud(1_200)], s);
    expect(s.phase).toBe("greeting");
    expect(s.botCaption).toBe("Hi");
    s = voiceReducer(s, quiet(1_200 + SPEAKING_HOLD_MS - 1)); // a gap between words: still speaking
    expect(s.phase).toBe("greeting");
    s = voiceReducer(s, quiet(1_200 + SPEAKING_HOLD_MS));
    expect(s).toMatchObject({ phase: "listening", greeted: true });
  });

  it("thinks through the holding line until the answer starts, then speaks, then listens", () => {
    let s = run([quiet(5_000), { type: "event", event: { kind: "caption.user", text: "What is RAG?" }, now: 6_000 }], connected());
    expect(s).toMatchObject({ phase: "thinking", userCaption: "What is RAG?", awaitingAnswer: true });
    s = run([{ type: "event", event: { kind: "caption.bot", text: "Let me check the lessons.", holding: true }, now: 6_100 }], s);
    expect(s.phase).toBe("speaking");
    s = voiceReducer(s, quiet(6_100 + SPEAKING_HOLD_MS)); // holding line over, answer not yet
    expect(s.phase).toBe("thinking");
    s = run([{ type: "event", event: { kind: "caption.bot", text: "RAG retrieves first." }, now: 9_000 }], s);
    expect(s).toMatchObject({ phase: "speaking", botCaption: "RAG retrieves first.", awaitingAnswer: false });
    s = run([{ type: "event", event: { kind: "caption.bot", text: "Then it writes." }, now: 11_000 }], s);
    expect(s.botCaption).toBe("RAG retrieves first. Then it writes.");
    s = voiceReducer(s, quiet(11_000 + SPEAKING_HOLD_MS));
    expect(s.phase).toBe("listening");
    // The next thing the caller says starts a new turn with fresh captions.
    s = run([{ type: "event", event: { kind: "caption.user", text: "And embeddings?" }, now: 20_000 }], s);
    expect(s).toMatchObject({ userCaption: "And embeddings?", botCaption: "" });
  });

  it("joins the pieces of one long question", () => {
    const s = run([quiet(4_000), { type: "event", event: { kind: "caption.user", text: "What is" }, now: 5_000 }, { type: "event", event: { kind: "caption.user", text: "RAG?" }, now: 5_500 }], connected());
    expect(s.userCaption).toBe("What is RAG?");
  });

  it("stops speaking at once on barge-in", () => {
    let s = run([{ type: "event", event: { kind: "caption.bot", text: "A long answer" }, now: 3_000 }, quiet(3_000)], connected());
    s = { ...s, phase: "speaking", greeted: true };
    s = voiceReducer(s, { type: "event", event: { kind: "audio.clear" }, now: 3_100 });
    expect(s.phase).toBe("listening");
  });

  it("counts down from an absolute deadline, also after a background tab", () => {
    let s = voiceReducer(connected(0), { type: "tick", now: 1_000 });
    expect(s.secondsLeft).toBe(299);
    s = voiceReducer(s, { type: "tick", now: (300 - ENDING_NOTICE_S) * 1000 - 1 });
    expect(s.endingSoon).toBe(false);
    s = voiceReducer(s, { type: "tick", now: (300 - ENDING_NOTICE_S) * 1000 }); // the tab slept, then woke
    expect(s).toMatchObject({ endingSoon: true, secondsLeft: ENDING_NOTICE_S });
    s = voiceReducer(s, { type: "tick", now: 400_000 });
    expect(s.secondsLeft).toBe(0);
  });

  it("keeps the first end reason and blocks a new call while closing", () => {
    let s = run([{ type: "closing" }, { type: "event", event: { kind: "call.closed", reason: "idle" }, now: 1 }], connected());
    expect(voiceReducer(s, { type: "start" })).toBe(s); // closing guard
    s = voiceReducer(s, { type: "ended", reason: "hung_up" });
    expect(s).toMatchObject({ phase: "ended", endReason: "idle", closing: false });
    expect(inCall(s)).toBe(false);
    expect(voiceReducer(s, { type: "start" }).phase).toBe("connecting");
  });

  it("fails and can be dismissed; levels outside a call are ignored", () => {
    const s = run([{ type: "start" }, { type: "failed", failure: "mic-denied" }]);
    expect(s).toMatchObject({ phase: "failed", failure: "mic-denied" });
    expect(voiceReducer(s, loud(1))).toBe(s);
    expect(voiceReducer(s, { type: "dismiss" }).phase).toBe("idle");
  });

  it("shows the mic once offered, without asking, until a call is refused", () => {
    expect(showMic(initialVoiceState)).toBe(false);
    let s = run([{ type: "offer", offered: true }]);
    expect(showMic(s)).toBe(true); // available is still null: nothing was asked
    s = run([{ type: "start" }], s);
    expect(showMic(s)).toBe(false); // in a call
    s = run([{ type: "status", available: false, said: true }, { type: "failed", failure: "unavailable" }, { type: "dismiss" }], s);
    expect(s).toMatchObject({ offered: true, saidUnavailable: true });
    expect(showMic(s)).toBe(false);
  });

  it("counts the seconds the voice model takes to wake", () => {
    let s = run([{ type: "offer", offered: true }, { type: "start" }, { type: "waking", now: 1_000 }]);
    expect(s).toMatchObject({ phase: "connecting", wakingSeconds: 0 });
    expect(phaseLabel(s)).toBe("Waking the voice model…");
    s = voiceReducer(s, { type: "tick", now: 38_500 });
    expect(s.wakingSeconds).toBe(37);
    s = voiceReducer(s, { type: "woke" });
    expect(s).toMatchObject({ wakingSince: null, wakingSeconds: null });
    expect(phaseLabel(s)).toBe("Connecting…");
    const failed = run([{ type: "waking", now: 0 }, { type: "failed", failure: "unavailable" }], run([{ type: "start" }]));
    expect(failed.wakingSeconds).toBeNull();
  });

  it("formats the clock", () => {
    expect(clockText(300)).toBe("5:00");
    expect(clockText(29)).toBe("0:29");
    expect(clockText(null)).toBe("");
  });
});
