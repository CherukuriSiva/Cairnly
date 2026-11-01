import type { Metadata } from "next";
import { InsightBrowser } from "@/components/insights/InsightBrowser";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CATEGORY_LABELS, getInsights } from "@/lib/content";
import type { InsightCard } from "@/lib/insights";

export const metadata: Metadata = {
  title: "Insights · cairnly",
  description: "Short summaries of recurring AI engineering discussions, in our own words.",
};

export default function InsightsPage() {
  const cards: InsightCard[] = getInsights().map(({ slug, title, summary, category, publishedAt, readingMinutes }) => ({
    slug,
    title,
    summary,
    category,
    publishedAt,
    readingMinutes,
  }));
  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <SectionHeader
        eyebrow="Insights"
        title="What the field is talking about"
        description="Short summaries of recurring industry discussions, in our own words."
        className="mb-10"
      />
      <InsightBrowser insights={cards} labels={CATEGORY_LABELS} />
    </main>
  );
}
