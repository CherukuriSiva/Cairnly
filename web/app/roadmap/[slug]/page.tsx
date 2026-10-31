import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Article } from "@/components/Article";
import { mdxComponents } from "@/components/mdx";
import { getRoadmap, getRoadmaps } from "@/lib/content";
import { renderMdx } from "@/lib/mdx";

export const runtime = "nodejs";
export const dynamicParams = false;

type Params = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getRoadmaps().map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${getRoadmap(slug)?.title ?? "Roadmap"} · cairnly` };
}

export default async function RoadmapPage({ params }: Params) {
  const { slug } = await params;
  const roadmap = getRoadmap(slug);
  if (!roadmap) notFound();
  const content = await renderMdx(roadmap.body, mdxComponents);
  return (
    <Article label={`Roadmap · ${roadmap.timeHorizon}`} title={roadmap.title} summary={roadmap.summary}>
      {content}
    </Article>
  );
}
