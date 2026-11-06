// The typewriter's arithmetic, kept pure so it can be tested without a browser. Tokens arrive in
// bursts; showing them at a steady pace reads better. The pace adapts to the backlog: with
// little waiting it types at about 80 characters a second, and every waiting character adds
// speed (rate = 80 + backlog / 0.8 s), so a backlog of a long answer's 1,200 characters is
// shown in about 2.5 seconds and even 4,000 in under 3.5. The React hook
// (components/chat/useReveal.ts) calls `revealStep` once per animation frame and commits at
// most about 30 times a second.

export const BASE_CHARS_PER_S = 80;
export const BACKLOG_S = 0.8; // each waiting character adds 1 / 0.8 characters a second
export const COMMIT_EVERY_MS = 33; // about 30 renders a second

/** Characters per second for a backlog of `backlog` characters. */
export function revealRate(backlog: number): number {
  return BASE_CHARS_PER_S + Math.max(0, backlog) / BACKLOG_S;
}

/** Advance the shown length by one frame of `dtMs`. `carry` keeps the fraction of a character
 * between frames, so slow frame rates do not lose speed. */
export function revealStep(shown: number, target: number, dtMs: number, carry = 0): { shown: number; carry: number } {
  if (shown >= target) return { shown: target, carry: 0 };
  const exact = carry + (revealRate(target - shown) * Math.max(0, dtMs)) / 1000;
  const whole = Math.floor(exact);
  const next = Math.min(target, shown + whole);
  return { shown: next, carry: next === target ? 0 : exact - whole };
}

/** Where to continue from when the target text changes: the same text grown keeps its place; a
 * replaced text (an answer withdrawn by the safety check, a corrected final text) is shown at
 * once, because typing out a correction would look like a new answer. */
export function revealFrom(previousTarget: string, nextTarget: string, shown: number): number {
  return nextTarget.startsWith(previousTarget) ? Math.min(shown, nextTarget.length) : nextTarget.length;
}
