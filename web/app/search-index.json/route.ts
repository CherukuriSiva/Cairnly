// /search-index.json: the command palette's data, written once at build time.

import { CATEGORY_LABELS, getInsights, getLesson, getRoadmaps } from "@/lib/content";
import { buildSearchIndex } from "@/lib/searchIndex";
import { flatLessons, getTrack } from "@/lib/syllabus";

export const dynamic = "force-static";

export function GET() {
  const lessons = flatLessons().flatMap((entry) => {
    const lesson = getLesson(entry.track, entry.slug);
    if (!lesson) return [];
    return [{ track: entry.track, slug: entry.slug, title: lesson.title, trackTitle: getTrack(entry.track)?.title ?? entry.track }];
  });
  return Response.json(
    buildSearchIndex({ lessons, roadmaps: getRoadmaps(), insights: getInsights(), categoryLabels: CATEGORY_LABELS }),
  );
}
