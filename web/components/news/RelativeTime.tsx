"use client";

import { useNow } from "@/components/news/useNow";
import { formatDate, relativeTime } from "@/lib/news/time";

/** A <time> showing the absolute date from the server, swapped for "3h ago" after mount (the
 * server render cannot know the reader's now). Refreshes every minute. */
export function RelativeTime({ iso }: { iso: string }) {
  const now = useNow();
  const absolute = formatDate(iso);
  if (!absolute) return null;
  return (
    <time dateTime={iso} title={absolute}>
      {now === null ? absolute : relativeTime(iso, now)}
    </time>
  );
}
