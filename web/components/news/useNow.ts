"use client";

import { useEffect, useState } from "react";

/** The current time, updated every minute; null on the server and during hydration, so the
 * first client render matches the server's absolute dates. */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
