import type { Metadata } from "next";
import { NewsBrowser } from "@/components/news/NewsBrowser";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { getNews } from "@/lib/news/fetch";
import { loadLinkedInPicks } from "@/lib/news/linkedin";
import { pageTitle } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("News"),
  description: "Fresh AI engineering reading from open sources, refreshed every hour.",
};

// Rebuilt in the background at most once an hour (the landing page too, for its news strip).
export const revalidate = 3600;

export default async function NewsPage() {
  const news = await getNews();
  const picks = loadLinkedInPicks();
  const generatedAt = new Date().toISOString();
  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <SectionHeader
        eyebrow="News"
        title="Fresh from the field"
        description="AI engineering reading from open sources, refreshed every hour. Links open the original source."
        className="mb-8"
      />
      <NewsBrowser news={news} picks={picks} generatedAt={generatedAt} />
    </main>
  );
}
