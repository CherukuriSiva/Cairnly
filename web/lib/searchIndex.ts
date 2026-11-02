// The command palette's static index: every lesson, roadmap and insight with a title, a link,
// a short meta line and search keywords. Built at build time by app/search-index.json/route.ts.
// rankItems() is the palette's own filter: whole words in the title first, scattered letters
// never.

import { horizonLabel } from "@/lib/roadmaps";

export type SearchKind = "lesson" | "roadmap" | "insight";

export interface SearchItem {
  type: SearchKind;
  title: string;
  href: string;
  /** Track title, time horizon or insight category label. */
  meta: string;
  /** Lower-ranked text to match: track and module for a lesson, tags and summary otherwise. */
  keywords: string;
}

export interface SearchSources {
  /** Lessons in syllabus order, with their track title and module. */
  lessons: { track: string; slug: string; title: string; trackTitle: string; module: string }[];
  roadmaps: { slug: string; title: string; timeHorizon: string; tags: string[]; summary: string }[];
  insights: { slug: string; title: string; category: string; tags: string[]; summary: string }[];
  categoryLabels: Record<string, string>;
}

export function buildSearchIndex({ lessons, roadmaps, insights, categoryLabels }: SearchSources): SearchItem[] {
  return [
    ...lessons.map((l): SearchItem => ({
      type: "lesson",
      title: l.title,
      href: `/${l.track}/${l.slug}`,
      meta: l.trackTitle,
      keywords: `${l.trackTitle} ${l.module}`,
    })),
    ...roadmaps.map((r): SearchItem => ({
      type: "roadmap",
      title: r.title,
      href: `/roadmap/${r.slug}`,
      meta: horizonLabel(r.timeHorizon),
      keywords: [...r.tags, r.summary].join(" "),
    })),
    ...insights.map((i): SearchItem => {
      const meta = categoryLabels[i.category] ?? i.category;
      return {
        type: "insight",
        title: i.title,
        href: `/insights/${i.slug}`,
        meta,
        keywords: [meta, ...i.tags, i.summary].join(" "),
      };
    }),
  ];
}

/** Lower-case words: letters and digits, split on everything else ("Fine-Tuning" → fine, tuning). */
function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

/**
 * How well an item matches the query; 0 means it does not. From best to worst: the title is the
 * query; the query is a whole word or phrase in the title (best at its start); the query starts
 * a word in the title; every query word starts a title word; the query sits inside a title
 * word (4+ letters only, so "rag" never matches "leverage"); every query word starts a word of
 * the title or keywords.
 */
export function scoreItem(item: Pick<SearchItem, "title" | "keywords">, query: string): number {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  const terms = words(q);
  if (terms.length === 0) return 0;
  const title = item.title.toLowerCase();
  if (title === q) return 1000;
  const at = title.indexOf(q);
  if (at >= 0) {
    const startsWord = !isWordChar(title[at - 1]);
    const endsWord = !isWordChar(title[at + q.length]);
    if (startsWord && endsWord) return at === 0 ? 900 : 800;
    if (startsWord) return at === 0 ? 700 : 600;
  }
  const titleWords = words(title);
  const startsTitleWord = (t: string) => titleWords.some((w) => w.startsWith(t));
  if (terms.every(startsTitleWord)) return 400;
  if (at >= 0 && q.length >= 4) return 200;
  const keywordWords = words(item.keywords);
  if (terms.every((t) => startsTitleWord(t) || keywordWords.some((w) => w.startsWith(t)))) return 100;
  return 0;
}

/** The items that match, best first; equal scores keep index order. An empty query keeps all. */
export function rankItems<T extends Pick<SearchItem, "title" | "keywords">>(items: T[], query: string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item, index) => ({ item, index, score: scoreItem(item, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}
