"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { COMMIT_EVERY_MS, revealFrom, revealStep } from "@/lib/chat/reveal";

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void): () => void {
  const media = window.matchMedia(REDUCED);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True when the reader asked for less motion (also on the server: no animation there). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => true);
}

/** Never cut a character in half (an emoji is two UTF-16 units). */
function safeEnd(text: string, end: number): number {
  const code = text.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? end + 1 : end;
}

/**
 * The part of `text` to show now, typed out with requestAnimationFrame (lib/chat/reveal.ts sets
 * the pace) and committed to React at most about 30 times a second. Text that is already
 * finished when the component mounts (history, a restored conversation) is shown at once, and
 * so is everything under reduced motion. Returns the text to show and whether it is still
 * catching up.
 */
export function useReveal(text: string, live: boolean): { shown: string; revealing: boolean } {
  const [animate] = useState(live); // decided once, at mount
  const reduced = usePrefersReducedMotion();
  const [count, setCount] = useState(animate ? 0 : text.length);
  const progress = useRef({ shown: animate ? 0 : text.length, carry: 0, target: animate ? "" : text });

  // One animation loop per text change: it continues from where the last one stopped (or
  // jumps, for a replaced text) and ends once everything is shown.
  useEffect(() => {
    if (!animate || reduced) return;
    const p = progress.current;
    p.shown = revealFrom(p.target, text, p.shown);
    p.target = text;
    let last = performance.now();
    let committed = last;
    let frame = 0;
    const tick = (now: number) => {
      const step = revealStep(p.shown, p.target.length, now - last, p.carry);
      last = Math.max(last, now);
      p.shown = safeEnd(p.target, step.shown);
      p.carry = step.carry;
      const done = p.shown >= p.target.length;
      if (done || now - committed >= COMMIT_EVERY_MS) {
        committed = now;
        setCount(p.shown);
      }
      if (!done) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, animate, reduced]);

  if (!animate || reduced) return { shown: text, revealing: false };
  const shown = text.slice(0, Math.min(count, text.length));
  return { shown, revealing: shown.length < text.length };
}
