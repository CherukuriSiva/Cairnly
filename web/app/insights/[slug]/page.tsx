import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Article } from "@/components/Article";
import { mdxComponents } from "@/components/mdx";
import { CATEGORY_LABELS, getInsight, getInsights } from "@/lib/content";
import { renderMdx } from "@/lib/mdx";

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
  return (
    <Article
      label={CATEGORY_LABELS[insight.category] ?? insight.category}
      title={insight.title}
      summary={insight.summary}
    >
      {content}
    </Article>
  );
}
