import { getRoadmap, getRoadmaps } from "@/lib/content";
import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";
import { SITE_NAME } from "@/lib/site";

export const alt = `A ${SITE_NAME} roadmap`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const dynamicParams = false;

export function generateStaticParams() {
  return getRoadmaps().map((r) => ({ slug: r.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return ogImage({ eyebrow: "Roadmap", title: getRoadmap(slug)?.title ?? `${SITE_NAME} roadmap` });
}
