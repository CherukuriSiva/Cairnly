import { getLesson } from "@/lib/content";
import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";
import { flatLessons, getTrack } from "@/lib/syllabus";

export const alt = "A cairnly lesson";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const dynamicParams = false;

export function generateStaticParams() {
  return flatLessons().map((e) => ({ track: e.track, slug: e.slug }));
}

export default async function Image({ params }: { params: Promise<{ track: string; slug: string }> }) {
  const { track, slug } = await params;
  return ogImage({
    eyebrow: getTrack(track)?.title ?? "Lesson",
    title: getLesson(track, slug)?.title ?? "cairnly lesson",
  });
}
