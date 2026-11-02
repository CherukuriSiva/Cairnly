import { CATEGORY_LABELS, getInsight, getInsights } from "@/lib/content";
import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";
import { SITE_NAME } from "@/lib/site";

export const alt = `A ${SITE_NAME} insight`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const dynamicParams = false;

export function generateStaticParams() {
  return getInsights().map((i) => ({ slug: i.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const insight = getInsight(slug);
  return ogImage({
    eyebrow: insight ? (CATEGORY_LABELS[insight.category] ?? insight.category) : "Insight",
    title: insight?.title ?? `${SITE_NAME} insight`,
  });
}
