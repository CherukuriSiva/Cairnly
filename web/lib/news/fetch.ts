// Server side: fetch every source, keep the last good items of a source that fails, and group.
// A failing source never throws out of here, so the page and the build survive any network state.

import { isAiTitle } from "./filter";
import { parseFeed, parseHfPapers, parseHn } from "./parse";
import { GROUP_CAPS, SOURCES, type Source, type SourceKind } from "./sources";
import type { NewsGroup, NewsItem, SourceResult } from "./types";

const TIMEOUT_MS = 8000;
const MAX_BYTES = 2 * 1024 * 1024;
const USER_AGENT = "cairnly-news/1.0 (+https://github.com/CherukuriSiva)";

/** Gets the body text of a URL. Injected in tests. */
export type Fetcher = (url: string) => Promise<string>;

/** Last good items per source id. Lives as long as the server process. */
export type LastGood = Map<string, NewsItem[]>;

const lastGood: LastGood = new Map();

const PARSERS: Record<SourceKind, (text: string, source: Source) => NewsItem[]> = {
  hn: parseHn,
  "hf-papers": parseHfPapers,
  feed: parseFeed,
};

/** The real fetcher: 8 second timeout, 2 MB limit, revalidated by Next every hour. */
export const fetchText: Fetcher = async (url) => {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate: 3600 },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error("response too large");
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error("response too large");
  return text;
};

/** Newest first; items without a readable date go last. */
function byDateDesc(a: NewsItem, b: NewsItem): number {
  if (a.date === b.date) return 0;
  if (a.date === "") return 1;
  if (b.date === "") return -1;
  return a.date < b.date ? 1 : -1;
}

function parseSource(source: Source, text: string): NewsItem[] {
  const items = PARSERS[source.kind](text, source);
  const kept = source.filter ? items.filter((item) => isAiTitle(item.title)) : items;
  return kept.sort(byDateDesc).slice(0, source.limit);
}

/** One source: fresh items on success, else the last good ones, else nothing. Never throws. */
export async function loadSource(source: Source, fetcher: Fetcher, cache: LastGood): Promise<SourceResult> {
  const base = { source: source.name, group: source.group };
  try {
    const items = parseSource(source, await fetcher(source.url));
    if (items.length === 0) throw new Error("no items parsed");
    cache.set(source.id, items);
    return { ...base, items, ok: true, stale: false };
  } catch {
    const previous = cache.get(source.id);
    return previous
      ? { ...base, items: previous, ok: false, stale: true }
      : { ...base, items: [], ok: false, stale: false };
  }
}

/** Merge the items of one group: drop duplicate links, newest first, capped. */
export function mergeGroup(results: SourceResult[], group: NewsGroup): NewsItem[] {
  const seen = new Set<string>();
  const merged: NewsItem[] = [];
  for (const item of results.filter((r) => r.group === group).flatMap((r) => r.items)) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    merged.push(item);
  }
  return merged.sort(byDateDesc).slice(0, GROUP_CAPS[group]);
}

/** The newest items across every group (the landing page's news strip), without repeats. */
export function latestAcross(news: Record<NewsGroup, NewsItem[]>, count: number): NewsItem[] {
  const seen = new Set<string>();
  return Object.values(news)
    .flat()
    .filter((item) => !seen.has(item.url) && seen.add(item.url))
    .sort(byDateDesc)
    .slice(0, count);
}

/** Fetch all sources in parallel and return them grouped for the page. */
export async function getNews(
  fetcher: Fetcher = fetchText,
  sources: Source[] = SOURCES,
  cache: LastGood = lastGood,
): Promise<Record<NewsGroup, NewsItem[]>> {
  const results = await Promise.all(sources.map((source) => loadSource(source, fetcher, cache)));
  return {
    community: mergeGroup(results, "community"),
    papers: mergeGroup(results, "papers"),
    blogs: mergeGroup(results, "blogs"),
  };
}
