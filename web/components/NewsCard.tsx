import { ArrowUpRight } from "lucide-react";
import { RelativeTime } from "@/components/news/RelativeTime";
import { SOURCE_COLORS } from "@/lib/news/sources";

interface NewsCardProps {
  source: string;
  date: string;
  title: string;
  url: string;
  /** Extra muted line under the title, e.g. the author of a LinkedIn post. */
  byline?: string;
  summary?: string;
  /** "compact" for the papers list: no card frame, summary clamped to 2 lines. */
  variant?: "card" | "compact";
}

/** One link to an outside source, opening in a new tab: a coloured source dot, the relative
 * date, the title with an ↗ icon and an optional summary. All text is rendered as React text,
 * never as HTML. */
export function NewsCard({ source, date, title, url, byline, summary, variant = "card" }: NewsCardProps) {
  const compact = variant === "compact";
  return (
    <li className={compact ? "py-4" : "rounded-2xl border border-border bg-surface-1 p-4 hover:border-border-strong sm:p-5"}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
        <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-wider text-muted">
          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: SOURCE_COLORS[source] ?? "var(--faint)" }} />
          {source}
        </span>
        {date && (
          <>
            <span aria-hidden="true">·</span>
            <RelativeTime iso={date} />
          </>
        )}
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="group mt-1.5 flex items-start gap-1.5 break-words font-semibold text-text hover:text-accent"
      >
        <span className="min-w-0">{title}</span>
        <ArrowUpRight size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-faint group-hover:text-accent" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      {byline ? <p className="mt-0.5 break-words text-xs text-muted">{byline}</p> : null}
      {summary ? (
        <p className={`mt-1.5 break-words text-sm text-muted ${compact ? "line-clamp-2" : "line-clamp-3"}`}>{summary}</p>
      ) : null}
    </li>
  );
}
