import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { mdxComponents } from "@/components/mdx";
import { ReadingLayout } from "@/components/reading/ReadingLayout";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { CATEGORY_LABELS, getInsight, getInsights, sectionTitles } from "@/lib/content";
import { relatedInsights } from "@/lib/insights";
import { renderMdx } from "@/lib/mdx";
import { pageOutline } from "@/lib/outline";

export const runtime = "nodejs";
export const dynamicParams = false;

type Params = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getInsights().map((i) => ({ slug: i.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const insight = getInsight(slug);
  return { title: `${insight?.title ?? "Insight"} · cairnly`, description: insight?.summary };
}

export default async function InsightPage({ params }: Params) {
  const { slug } = await params;
  const insight = getInsight(slug);
  if (!insight) notFound();
  const content = await renderMdx(insight.body, mdxComponents);
  const label = CATEGORY_LABELS[insight.category] ?? insight.category;
  const related = relatedInsights(getInsights(), insight);

  const header = (
    <header>
      <p className="eyebrow text-accent">
        <Link href={`/insights?category=${insight.category}`} className="hover:underline">
          {label}
        </Link>
      </p>
      <h1 className="text-display mt-3">{insight.title}</h1>
      {insight.summary && <p className="mt-4 text-lg text-muted">{insight.summary}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        <Badge>{insight.readingMinutes} min read</Badge>
      </div>
    </header>
  );

  const footer = related.length > 0 && (
    <section aria-labelledby="related-heading" className="mt-16 border-t border-border pt-10">
      <h2 id="related-heading" className="text-display-2">
        Related insights
      </h2>
      <ul className="mt-5 grid gap-3">
        {related.map((other) => (
          <li key={other.slug}>
            <Card href={`/insights/${other.slug}`} className="p-5">
              <span className="font-semibold text-text">{other.title}</span>
              <span className="mt-1 line-clamp-2 block text-sm text-muted">{other.summary}</span>
              <span className="mt-3 block font-mono text-xs text-faint">{other.readingMinutes} min read</span>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <ReadingLayout header={header} outline={pageOutline(insight.body, sectionTitles())} footer={footer || undefined}>
      {content}
    </ReadingLayout>
  );
}
