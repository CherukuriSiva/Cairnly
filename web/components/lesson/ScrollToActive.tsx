"use client";

import { useEffect, useRef } from "react";

/** A scrolling container that, on load, scrolls so the current lesson link is in view.
 * Only the container scrolls; the page itself does not move. */
export function ScrollToActive({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = ref.current;
    const item = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !item) return;
    // The container is `relative`, so offsetTop is measured from its top edge.
    const top = item.offsetTop;
    if (top + item.offsetHeight > box.clientHeight) box.scrollTop = top - box.clientHeight / 3;
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
