// Auto-scroll rules, kept pure: follow new answer text while the reader is at the bottom of the
// page, stop as soon as they scroll up (wheel, touch, keys or the scrollbar), and follow again
// once they come back to the bottom. The hook is components/chat/useFollow.ts.

export const BOTTOM_SLACK_PX = 8; // this close to the end counts as "at the bottom"

export function atBottom(scrollTop: number, viewportHeight: number, scrollHeight: number, slack = BOTTOM_SLACK_PX): boolean {
  return scrollTop + viewportHeight >= scrollHeight - slack;
}

/** Following after a scroll from `lastTop` to `top`: on at the bottom, off after any move up,
 * unchanged otherwise (a move down that has not reached the end yet). */
export function followAfterScroll(following: boolean, lastTop: number, top: number, viewportHeight: number, scrollHeight: number): boolean {
  if (atBottom(top, viewportHeight, scrollHeight)) return true;
  if (top < lastTop - 1) return false;
  return following;
}

const UP_KEYS = new Set(["ArrowUp", "PageUp", "Home"]);

/** Input that means "I want to read further up": stop following before the scroll lands. For
 * wheel and touch, `deltaY` < 0 is a move up (a finger dragging down). Keys typed into a text
 * field move its cursor, not the page, so they do not count. */
export function stopsFollowing(e: { type: string; deltaY?: number; key?: string; shiftKey?: boolean; editable?: boolean }): boolean {
  if (e.type === "wheel" || e.type === "touchmove") return (e.deltaY ?? 0) < 0;
  if (e.type === "keydown" && !e.editable) return UP_KEYS.has(e.key ?? "") || (e.key === " " && Boolean(e.shiftKey));
  return false;
}
