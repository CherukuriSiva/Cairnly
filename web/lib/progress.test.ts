import { describe, expect, it } from "vitest";
import {
  doneCount,
  EMPTY_PROGRESS,
  isDone,
  lessonKey,
  parseProgress,
  serializeProgress,
  setCheck,
  setDone,
} from "@/lib/progress";

describe("parseProgress", () => {
  it("reads nothing done from missing, corrupt or wrongly shaped storage", () => {
    expect(parseProgress(null)).toEqual(EMPTY_PROGRESS);
    expect(parseProgress("")).toEqual(EMPTY_PROGRESS);
    expect(parseProgress("{not json")).toEqual(EMPTY_PROGRESS);
    expect(parseProgress("42")).toEqual(EMPTY_PROGRESS);
    expect(parseProgress('"text"')).toEqual(EMPTY_PROGRESS);
    expect(parseProgress("null")).toEqual(EMPTY_PROGRESS);
    expect(parseProgress('{"done": "dsa/arrays", "checks": []}')).toEqual({ done: [], checks: {} });
  });

  it("keeps valid entries and drops bad ones", () => {
    const raw = JSON.stringify({
      done: ["dsa/arrays", 7, "dsa/arrays", null, "career/resume"],
      checks: { "dsa/arrays": [2, 0, -1, 1.5, "3", 2], "career/resume": "x" },
    });
    expect(parseProgress(raw)).toEqual({ done: ["dsa/arrays", "career/resume"], checks: { "dsa/arrays": [0, 2] } });
  });

  it("round-trips through serializeProgress", () => {
    const progress = { done: ["a/b"], checks: { "a/b": [0, 3] } };
    expect(parseProgress(serializeProgress(progress))).toEqual(progress);
  });
});

describe("setDone", () => {
  const key = lessonKey("dsa", "arrays");

  it("marks, unmarks and toggles a lesson", () => {
    const done = setDone(EMPTY_PROGRESS, key, true);
    expect(isDone(done, key)).toBe(true);
    expect(isDone(setDone(done, key, false), key)).toBe(false);
    expect(isDone(setDone(done, key), key)).toBe(false);
    expect(isDone(setDone(EMPTY_PROGRESS, key), key)).toBe(true);
  });

  it("returns the same object when nothing changes", () => {
    const done = setDone(EMPTY_PROGRESS, key, true);
    expect(setDone(done, key, true)).toBe(done);
    expect(setDone(EMPTY_PROGRESS, key, false)).toBe(EMPTY_PROGRESS);
  });
});

describe("setCheck", () => {
  it("ticks and unticks checklist items in order, per lesson", () => {
    let p = setCheck(EMPTY_PROGRESS, "a/b", 2, true);
    p = setCheck(p, "a/b", 0, true);
    p = setCheck(p, "c/d", 1, true);
    expect(p.checks).toEqual({ "a/b": [0, 2], "c/d": [1] });
    p = setCheck(p, "a/b", 2, false);
    expect(p.checks["a/b"]).toEqual([0]);
    expect(setCheck(p, "a/b", 0, true)).toBe(p);
  });

  it("never touches the done list", () => {
    expect(setCheck(EMPTY_PROGRESS, "a/b", 0, true).done).toEqual([]);
  });
});

describe("doneCount", () => {
  it("counts only the given lessons", () => {
    const p = { done: ["dsa/a", "dsa/b", "career/c"], checks: {} };
    expect(doneCount(p, ["dsa/a", "dsa/b", "dsa/x"])).toBe(2);
    expect(doneCount(p, [])).toBe(0);
  });
});
