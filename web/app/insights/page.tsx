import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORY_LABELS, getInsights } from "@/lib/content";

export const metadata: Metadata = { title: "Insights · cairnly" };

export default function InsightsPage() {
  const insights = getInsights();
  const categories = Object.keys(CATEGORY_LABELS).filter((c) => insights.some((i) => i.category === c));
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-3xl font-bold tracking-tight">Insights</h1>
      <p className="mt-3" style={{ color: "var(--muted)" }}>
        Short summaries of recurring industry discussions, in our own words.
      </p>
      {categories.map((category) => (
        <section key={category} className="mt-10">
          <h2 className="text-lg font-semibold">{CATEGORY_LABELS[category]}</h2>
          <ul className="mt-3 space-y-3">
            {insights
              .filter((i) => i.category === category)
              .map((insight) => (
                <li key={insight.slug}>
                  <Link
                    href={`/insights/${insight.slug}`}
                    className="block rounded-xl border p-4 hover:border-[var(--accent)]"
                    style={{ borderColor: "var(--line)", background: "var(--panel)" }}
                  >
                    <span className="block font-semibold">{insight.title}</span>
                    <span className="mt-1 block text-sm" style={{ color: "var(--muted)" }}>
                      {insight.summary}
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
