// The open sources the News page reads. Data only: add a source by adding a row.

import type { NewsGroup } from "./types";

export type SourceKind = "hn" | "hf-papers" | "feed";

export interface Source {
  id: string;
  name: string;
  group: NewsGroup;
  url: string;
  kind: SourceKind;
  /** Most items kept from this source. */
  limit: number;
  /** Keep only titles that look AI related (for sources that are not AI only). */
  filter?: boolean;
}

export const SOURCES: Source[] = [
  {
    id: "hn",
    name: "Hacker News",
    group: "community",
    url: "https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E30&hitsPerPage=200",
    kind: "hn",
    limit: 8,
    filter: true,
  },
  {
    id: "arxiv",
    name: "arXiv",
    group: "papers",
    url: "https://export.arxiv.org/api/query?search_query=cat:cs.CL+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=8",
    kind: "feed",
    limit: 5,
  },
  {
    id: "hf-papers",
    name: "Hugging Face Papers",
    group: "papers",
    url: "https://huggingface.co/api/daily_papers",
    kind: "hf-papers",
    limit: 5,
  },
  { id: "huggingface-blog", name: "Hugging Face Blog", group: "blogs", url: "https://huggingface.co/blog/feed.xml", kind: "feed", limit: 3 },
  { id: "openai", name: "OpenAI", group: "blogs", url: "https://openai.com/news/rss.xml", kind: "feed", limit: 3 },
  { id: "deepmind", name: "Google DeepMind", group: "blogs", url: "https://deepmind.google/blog/rss.xml", kind: "feed", limit: 3 },
  { id: "simon-willison", name: "Simon Willison", group: "blogs", url: "https://simonwillison.net/atom/everything/", kind: "feed", limit: 3 },
  { id: "chip-huyen", name: "Chip Huyen", group: "blogs", url: "https://huyenchip.com/feed.xml", kind: "feed", limit: 3 },
  { id: "eugene-yan", name: "Eugene Yan", group: "blogs", url: "https://eugeneyan.com/rss/", kind: "feed", limit: 3 },
  { id: "latent-space", name: "Latent Space", group: "blogs", url: "https://www.latent.space/feed", kind: "feed", limit: 3 },
];

/** How many items each group shows after the sources are merged. */
export const GROUP_CAPS: Record<NewsGroup, number> = { community: 8, papers: 10, blogs: 12 };

export const GROUP_LABELS: Record<NewsGroup, string> = {
  community: "Community",
  papers: "Papers",
  blogs: "Blogs",
};
