const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "31 Oct 2026" from an ISO date, or "" when there is none. */
function formatDate(iso: string): string {
  const time = new Date(iso).getTime();
  return iso && !Number.isNaN(time) ? DATE_FORMAT.format(time) : "";
}

interface NewsCardProps {
  source: string;
  date: string;
  title: string;
  url: string;
  /** Extra muted line under the title, e.g. the author of a LinkedIn post. */
  byline?: string;
  summary?: string;
}

/** One link card. All text is rendered as React text, never as HTML. */
export function NewsCard({ source, date, title, url, byline, summary }: NewsCardProps) {
  const when = formatDate(date);
  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4 hover:border-[var(--accent)]">
      <div className="flex flex-wrap items-center gap-x-1 text-xs text-[var(--muted)]">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--accent)" }}>
          {source}
        </span>
        {when ? <span>· {when}</span> : null}
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 block break-words font-semibold hover:underline"
      >
        {title}
      </a>
      {byline ? <p className="mt-0.5 break-words text-xs text-[var(--muted)]">{byline}</p> : null}
      {summary ? <p className="mt-1 break-words text-sm text-[var(--muted)]">{summary}</p> : null}
    </li>
  );
}
