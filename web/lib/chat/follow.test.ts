import { describe, expect, it } from "vitest";
import { atBottom, followAfterScroll, stopsFollowing } from "@/lib/chat/follow";

describe("follow", () => {
  it("counts the last few pixels as the bottom", () => {
    expect(atBottom(1000, 800, 1800)).toBe(true);
    expect(atBottom(995, 800, 1800)).toBe(true);
    expect(atBottom(900, 800, 1800)).toBe(false);
  });

  it("stops after a move up and resumes at the bottom", () => {
    expect(followAfterScroll(true, 1000, 980, 800, 1800)).toBe(false);
    expect(followAfterScroll(false, 500, 700, 800, 1800)).toBe(false); // going down, not there yet
    expect(followAfterScroll(false, 700, 1000, 800, 1800)).toBe(true);
    expect(followAfterScroll(true, 600, 1000, 800, 1800)).toBe(true); // our own scroll to the end
  });

  it("wheel or touch up and the up keys stop following; typing in a field does not", () => {
    expect(stopsFollowing({ type: "wheel", deltaY: -40 })).toBe(true);
    expect(stopsFollowing({ type: "wheel", deltaY: 40 })).toBe(false);
    expect(stopsFollowing({ type: "touchmove", deltaY: -10 })).toBe(true);
    expect(stopsFollowing({ type: "keydown", key: "PageUp" })).toBe(true);
    expect(stopsFollowing({ type: "keydown", key: " ", shiftKey: true })).toBe(true);
    expect(stopsFollowing({ type: "keydown", key: "ArrowUp", editable: true })).toBe(false);
    expect(stopsFollowing({ type: "keydown", key: "ArrowDown" })).toBe(false);
  });
});
