// Picking insights for the /insights index and the "Related insights" list.

export interface InsightCard {
  slug: string;
  title: string;
  summary: string;
  category: string;
  publishedAt: string;
  readingMinutes: number;
}

/** Insights in one category ("" = all) whose title or summary contains the query. */
export function filterInsights<T extends Pick<InsightCard, "title" | "summary" | "category">>(
  insights: T[],
  category: string,
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  return insights.filter(
    (i) =>
      (!category || i.category === category) &&
      (!q || i.title.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q)),
  );
}

/** Up to `count` other insights from the same category, in their given order. */
export function relatedInsights<T extends Pick<InsightCard, "slug" | "category">>(all: T[], current: T, count = 3): T[] {
  return all.filter((i) => i.category === current.category && i.slug !== current.slug).slice(0, count);
}
