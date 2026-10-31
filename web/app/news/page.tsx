import type { Metadata } from "next";
import { NewsCard } from "@/components/NewsCard";
import { getNews } from "@/lib/news/fetch";
import { loadLinkedInPicks } from "@/lib/news/linkedin";
import { GROUP_LABELS } from "@/lib/news/sources";
import type { NewsGroup } from "@/lib/news/types";

export const metadata: Metadata = { title: "News · cairnly" };

// Rebuilt in the background at most once an hour; every other page stays fully static.
export const revalidate = 3600;

const GROUP_ORDER: NewsGroup[] = ["community", "papers", "blogs"];
const GROUP_HINTS: Record<NewsGroup, string> = {
  community: "Hacker News, AI stories only",
  papers: "arXiv and Hugging Face",
  blogs: "AI labs and practitioners",
};

export default async function NewsPage() {
  const news = await getNews();
  const picks = loadLinkedInPicks();
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-3xl font-bold tracking-tight">News</h1>
      <p className="mt-3" style={{ color: "var(--muted)" }}>
        Fresh AI-engineering reading from open sources, refreshed every hour, plus a few LinkedIn posts worth your time.
      </p>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Latest</h2>
        {GROUP_ORDER.map((group) => (
          <div key={group} className="mt-6">
            <h3 className="text-sm font-semibold">
              {GROUP_LABELS[group]} <span className="font-normal text-[var(--muted)]">· {GROUP_HINTS[group]}</span>
            </h3>
            {news[group].length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">Couldn&apos;t reach these sources right now. Try again later.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {news[group].map((item) => (
                  <NewsCard
                    key={item.url}
                    source={item.source}
                    date={item.date}
                    title={item.title}
                    url={item.url}
                    summary={item.summary}
                  />
                ))}
              </ul>
            )}
          </div>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">LinkedIn picks</h2>
        {picks.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">No picks yet. Add posts to content/news/linkedin.yaml.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {picks.map((pick) => (
              <NewsCard
                key={pick.url}
                source="LinkedIn"
                date={pick.date}
                title={pick.title}
                url={pick.url}
                byline={pick.author}
                summary={pick.note}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="mt-10 text-xs text-[var(--muted)]">
        Links open the original source. Thank you to arXiv for use of its open access interoperability.
      </p>
    </main>
  );
}
