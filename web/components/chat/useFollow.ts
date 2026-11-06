"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { followAfterScroll, stopsFollowing } from "@/lib/chat/follow";

function pageBottom(): number {
  return document.documentElement.scrollHeight;
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/**
 * Keep the page scrolled to the newest text while the reader is at the bottom (lib/chat/
 * follow.ts has the rules). Watches `content` for growth. `toBottom()` jumps to the end and
 * follows again, for when the reader sends a question.
 */
export function useFollow(content: RefObject<HTMLElement | null>): { toBottom: () => void } {
  const following = useRef(true);
  const lastTop = useRef(0);
  const touchY = useRef<number | null>(null);

  useEffect(() => {
    lastTop.current = window.scrollY;
    const onScroll = () => {
      const top = window.scrollY;
      following.current = followAfterScroll(following.current, lastTop.current, top, window.innerHeight, pageBottom());
      lastTop.current = top;
    };
    const stop = (e: Parameters<typeof stopsFollowing>[0]) => {
      if (stopsFollowing(e)) following.current = false;
    };
    const onWheel = (e: WheelEvent) => stop({ type: "wheel", deltaY: e.deltaY });
    const onTouchStart = (e: TouchEvent) => (touchY.current = e.touches[0]?.clientY ?? null);
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (y === undefined || touchY.current === null) return;
      stop({ type: "touchmove", deltaY: touchY.current - y }); // a finger dragging down reads further up
    };
    const onKey = (e: KeyboardEvent) => stop({ type: "keydown", key: e.key, shiftKey: e.shiftKey, editable: isEditable(e.target) });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("keydown", onKey);

    const grown = new ResizeObserver(() => {
      if (following.current) window.scrollTo({ top: pageBottom() });
    });
    if (content.current) grown.observe(content.current);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
      grown.disconnect();
    };
  }, [content]);

  const toBottom = useCallback(() => {
    following.current = true;
    window.scrollTo({ top: pageBottom() });
  }, []);
  return { toBottom };
}
