"use client";

import { useSyncExternalStore } from "react";
import { getProgress, getServerProgress, subscribeProgress, type Progress } from "@/lib/progress";

/** This browser's reading progress (lib/progress.ts). The server render and the hydration
 * pass see nothing done, so the markup matches; the saved state follows right after. */
export function useProgress(): Progress {
  return useSyncExternalStore(subscribeProgress, getProgress, getServerProgress);
}
