// Shared shapes for the News page.

export type NewsGroup = "community" | "papers" | "blogs";

/** One headline from an open source, already cleaned and safe to render as text. */
export interface NewsItem {
  id: string;
  source: string;
  group: NewsGroup;
  title: string;
  /** Always an http(s) URL. */
  url: string;
  /** ISO date string, or "" when the source gave none or an unreadable one. */
  date: string;
  /** Plain text, at most 200 characters. May be empty. */
  summary: string;
}

/** What one source gave on the latest fetch. */
export interface SourceResult {
  source: string;
  group: NewsGroup;
  items: NewsItem[];
  /** True when the fetch worked. */
  ok: boolean;
  /** True when `items` are the last good ones from an earlier fetch. */
  stale: boolean;
}
