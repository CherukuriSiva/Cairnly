import { describe, expect, it } from "vitest";
import { BASE_CHARS_PER_S, revealFrom, revealRate, revealStep } from "@/lib/chat/reveal";

/** Frames of 16 ms until everything is shown; returns the time it took. */
function drain(target: number, frameMs = 16): number {
  let shown = 0;
  let carry = 0;
  let t = 0;
  while (shown < target) {
    ({ shown, carry } = revealStep(shown, target, frameMs, carry));
    t += frameMs;
  }
  return t;
}

describe("reveal", () => {
  it("types at about 80 characters a second when little is waiting", () => {
    expect(revealRate(0)).toBe(BASE_CHARS_PER_S);
    expect(revealRate(8)).toBe(90);
  });

  it("keeps pace with a stream of tokens, a few words behind", () => {
    // Text arriving at 200 characters a second: the lag settles near (200 - 80) x 0.8 = 96.
    let shown = 0;
    let carry = 0;
    let target = 0;
    for (let t = 0; t < 5000; t += 16) {
      target += 200 * 0.016;
      ({ shown, carry } = revealStep(shown, Math.floor(target), 16, carry));
    }
    expect(target - shown).toBeGreaterThan(80);
    expect(target - shown).toBeLessThan(110);
  });

  it("shows a long backlog within about 3 seconds", () => {
    expect(drain(1200)).toBeLessThanOrEqual(2600);
    expect(drain(4000)).toBeLessThanOrEqual(3500);
  });

  it("keeps fractions between frames so slow frame rates lose no speed", () => {
    expect(Math.abs(drain(500, 50) - drain(500, 5))).toBeLessThan(150);
    expect(revealStep(5, 5, 16)).toEqual({ shown: 5, carry: 0 });
  });

  it("continues a growing text and jumps to a replaced one", () => {
    expect(revealFrom("Retrieve", "Retrieve then", 4)).toBe(4);
    expect(revealFrom("secret prompt", "Withdrawn.", 6)).toBe("Withdrawn.".length);
  });
});
