"use client";

import { useEffect, useRef, useState } from "react";

/** The stone on the trail beside a roadmap stage. It fills with the accent once its stage has
 * reached the top 40% of the viewport (and stays filled above it). */
export function StoneMarker() {
  const ref = useRef<HTMLSpanElement>(null);
  const [reached, setReached] = useState(false);

  useEffect(() => {
    const stage = ref.current?.parentElement;
    if (!stage) return;
    const observer = new IntersectionObserver(
      ([entry]) => setReached(entry.isIntersecting || entry.boundingClientRect.top < 0),
      { rootMargin: "0px 0px -60% 0px" },
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-reached={reached}
      className={`absolute left-0 top-1.5 h-3.5 w-5 rounded-full border-2 transition-colors duration-300 ${
        reached ? "border-accent bg-accent" : "border-border-strong bg-bg"
      }`}
    />
  );
}
