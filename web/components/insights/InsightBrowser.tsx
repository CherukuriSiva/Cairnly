"use client";

import { Search, SearchX } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterChips } from "@/components/ui/FilterChips";
import { filterInsights, type InsightCard } from "@/lib/insights";
import { latestByDate } from "@/lib/stats";

function Meta({ insight, labels }: { insight: InsightCard; labels: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge tone="accent">{labels[insight.category] ?? insight.category}</Badge>
      <Badge>{insight.readingMinutes} min read</Badge>
    </div>
  );
}

type BrowserProps = { insights: InsightCard[]; labels: Record<string, string> };

/** /insights: category chips (driven by ?category=), a search over titles and summaries, the
 * newest match as a large card and the rest in a grid. The static HTML shows every category;
 * the browser then follows the address bar, so /insights?category= links work on /insights too. */
export function InsightBrowser(props: BrowserProps) {
  return (
    <Suspense fallback={<Browser {...props} category="" />}>
      <BrowserFromUrl {...props} />
    </Suspense>
  );
}

function BrowserFromUrl(props: BrowserProps) {
  const wanted = useSearchParams().get("category");
  return <Browser {...props} category={wanted && wanted in props.labels ? wanted : ""} />;
}

function Browser({ insights, labels, category }: BrowserProps & { category: string }) {
  const [query, setQuery] = useState("");

  // Next.js syncs replaceState into useSearchParams, which re-renders with the new category.
  function choose(next: string) {
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("category", next);
    else url.searchParams.delete("category");
    window.history.replaceState(null, "", url.pathname + url.search);
  }

  const matches = filterInsights(insights, category, query);
  const [featured, ...rest] = latestByDate(matches, matches.length);
  const options = [{ value: "", label: "All" }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))];

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <FilterChips label="Category" options={options} value={category} onChange={choose} />
        <div className="relative lg:w-72">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search insights"
            placeholder="Search insights"
            className="h-10 w-full rounded-xl border border-border bg-surface-1 pl-9 pr-3 text-sm text-text placeholder:text-faint focus:border-accent"
          />
        </div>
      </div>
      <p className="mt-3 font-mono text-xs text-faint" aria-live="polite">
        {matches.length} {matches.length === 1 ? "insight" : "insights"}
      </p>

      {!featured ? (
        <div className="mt-6">
          <EmptyState icon={SearchX} title="No insights match" text="Try another word or another category." />
        </div>
      ) : (
        <>
          <Card href={`/insights/${featured.slug}`} className="mt-6 p-6 sm:p-8">
            <p className="eyebrow text-accent">Latest</p>
            <h2 className="text-display-2 mt-2 text-text">{featured.title}</h2>
            <p className="mt-3 max-w-[65ch] text-base text-muted">{featured.summary}</p>
            <div className="mt-5">
              <Meta insight={featured} labels={labels} />
            </div>
          </Card>
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {rest.map((insight) => (
              <li key={insight.slug}>
                <Card href={`/insights/${insight.slug}`} className="flex h-full flex-col p-5">
                  <Meta insight={insight} labels={labels} />
                  <h3 className="mt-4 font-semibold text-text">{insight.title}</h3>
                  <p className="mt-2 line-clamp-3 text-sm text-muted">{insight.summary}</p>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
