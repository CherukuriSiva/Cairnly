"use client";

import { useEffect, useState } from "react";

/** A 2px accent bar fixed under the header showing how far down the page the reader is. */
export function ReadingProgress() {
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      setPercent(max > 0 ? Math.min(100, Math.max(0, Math.round((window.scrollY / max) * 100))) : 100);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div
      role="progressbar"
      aria-label="Reading progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="pointer-events-none fixed inset-x-0 top-14 z-30 h-0.5"
    >
      <div className="h-full origin-left bg-accent" style={{ transform: `scaleX(${percent / 100})` }} />
    </div>
  );
}
