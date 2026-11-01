"use client";

import { ProgressMeter } from "@/components/progress/ProgressMeter";
import { useProgress } from "@/components/progress/useProgress";
import { doneCount } from "@/lib/progress";

/** "N / M done" for a set of lessons ("<track>/<slug>" keys), from this browser's progress. */
export function TrackProgress({ keys, className }: { keys: string[]; className?: string }) {
  const progress = useProgress();
  return <ProgressMeter done={doneCount(progress, keys)} total={keys.length} className={className} />;
}
