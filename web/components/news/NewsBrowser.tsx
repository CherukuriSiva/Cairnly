"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { NewsCard } from "@/components/NewsCard";
import { useNow } from "@/components/news/useNow";
import { FilterChips } from "@/components/ui/FilterChips";
import type { LinkedInPick } from "@/lib/news/linkedin";
import { GROUP_LABELS } from "@/lib/news/sources";
import { formatDate, refreshedAgo } from "@/lib/news/time";
import type { NewsGroup, NewsItem } from "@/lib/news/types";

const GROUP_ORDER: NewsGroup[] = ["community", "papers", "blogs"];
const GROUP_HINTS: Record<NewsGroup, string> = {
  community: "Hacker News, AI stories only",
  papers: "arXiv and Hugging Face",
  blogs: "AI labs and practitioners",
};

type Filter = "all" | NewsGroup;

/** "Last refreshed 12 min ago", from when the server built the page. */
function Refreshed({ generatedAt }: { generatedAt: string }) {
  const now = useNow();
  return (
    <p className="inline-flex items-center gap-1.5 font-mono text-xs text-faint">
      <RefreshCw size={12} aria-hidden="true" />
      Last refreshed{" "}
      <time dateTime={generatedAt}>{now === null ? formatDate(generatedAt) : refreshedAgo(generatedAt, now)}</time>
    </p>
  );
}

/** /news: group chips, the refresh note, community and blog cards, a compact papers list, and
 * the hand-picked LinkedIn posts (only when there are any). */
export function NewsBrowser({
  news,
  picks,
  generatedAt,
}: {
  news: Record<NewsGroup, NewsItem[]>;
  picks: LinkedInPick[];
  generatedAt: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const groups = filter === "all" ? GROUP_ORDER : [filter];
  const options = [{ value: "all" as Filter, label: "All" }, ...GROUP_ORDER.map((g) => ({ value: g as Filter, label: GROUP_LABELS[g] }))];

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips label="Source type" options={options} value={filter} onChange={setFilter} />
        <Refreshed generatedAt={generatedAt} />
      </div>

      {groups.map((group) => (
        <section key={group} aria-labelledby={`news-${group}`} className="mt-10">
          <h2 id={`news-${group}`} className="text-display-2">
            {GROUP_LABELS[group]}
          </h2>
          <p className="mt-1 text-sm text-muted">{GROUP_HINTS[group]}</p>
          {news[group].length === 0 ? (
            <p className="mt-4 text-sm text-muted">Couldn&apos;t reach these sources right now. Try again later.</p>
          ) : group === "papers" ? (
            <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface-1 px-4 sm:px-5">
              {news[group].map((item) => (
                <NewsCard key={item.url} variant="compact" source={item.source} date={item.date} title={item.title} url={item.url} summary={item.summary} />
              ))}
            </ul>
          ) : (
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {news[group].map((item) => (
                <NewsCard key={item.url} source={item.source} date={item.date} title={item.title} url={item.url} summary={item.summary} />
              ))}
            </ul>
          )}
        </section>
      ))}

      {picks.length > 0 && (filter === "all" || filter === "community") && (
        <section aria-labelledby="news-linkedin" className="mt-10">
          <h2 id="news-linkedin" className="text-display-2">
            LinkedIn picks
          </h2>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {picks.map((pick) => (
              <NewsCard key={pick.url} source="LinkedIn" date={pick.date} title={pick.title} url={pick.url} byline={pick.author} summary={pick.note} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
