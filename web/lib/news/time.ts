// Dates on the News page: an absolute date for the server render, a relative one after mount.

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "31 Oct 2026" from an ISO date, or "" when there is none or it is unreadable. */
export function formatDate(iso: string): string {
  const time = new Date(iso).getTime();
  return iso && !Number.isNaN(time) ? DATE_FORMAT.format(time) : "";
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5m ago", "3h ago", "2d ago"; the absolute date after 30 days, or for a date in
 * the future (clock skew) and "" for no date. */
export function relativeTime(iso: string, now: number): string {
  const time = new Date(iso).getTime();
  if (!iso || Number.isNaN(time)) return "";
  const diff = now - time;
  if (diff < 0) return diff > -5 * MINUTE ? "just now" : formatDate(iso);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return formatDate(iso);
}

/** "Last refreshed 12 min ago" style wording for the page note. */
export function refreshedAgo(iso: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / MINUTE));
  if (Number.isNaN(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}
