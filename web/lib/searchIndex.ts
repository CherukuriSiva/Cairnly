// The command palette's static index: every lesson, roadmap and insight with a title, a link
// and a short meta line. Built at build time by app/search-index.json/route.ts.

import { horizonLabel } from "@/lib/roadmaps";

export type SearchKind = "lesson" | "roadmap" | "insight";

export interface SearchItem {
  type: SearchKind;
  title: string;
  href: string;
  /** Track title, time horizon or insight category label. */
  meta: string;
}

export interface SearchSources {
  /** Lessons in syllabus order, with their track title. */
  lessons: { track: string; slug: string; title: string; trackTitle: string }[];
  roadmaps: { slug: string; title: string; timeHorizon: string }[];
  insights: { slug: string; title: string; category: string }[];
  categoryLabels: Record<string, string>;
}

export function buildSearchIndex({ lessons, roadmaps, insights, categoryLabels }: SearchSources): SearchItem[] {
  return [
    ...lessons.map((l): SearchItem => ({
      type: "lesson",
      title: l.title,
      href: `/${l.track}/${l.slug}`,
      meta: l.trackTitle,
    })),
    ...roadmaps.map((r): SearchItem => ({
      type: "roadmap",
      title: r.title,
      href: `/roadmap/${r.slug}`,
      meta: horizonLabel(r.timeHorizon),
    })),
    ...insights.map((i): SearchItem => ({
      type: "insight",
      title: i.title,
      href: `/insights/${i.slug}`,
      meta: categoryLabels[i.category] ?? i.category,
    })),
  ];
}
