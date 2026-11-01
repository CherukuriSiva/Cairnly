import { MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LessonDrawer } from "@/components/lesson/LessonDrawer";
import { ScrollToActive } from "@/components/lesson/ScrollToActive";
import { TrackNav, type NavTrack } from "@/components/lesson/TrackNav";
import { mdxComponents } from "@/components/mdx";
import { LessonScope, MarkDone } from "@/components/mdx/checklist";
import { ReadingLayout } from "@/components/reading/ReadingLayout";
import { Badge, DifficultyBadge, DurationBadge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { slugify } from "@/lib/anchors";
import { getLesson, sectionTitles } from "@/lib/content";
import { renderMdx } from "@/lib/mdx";
import { pageOutline } from "@/lib/outline";
import { lessonKey } from "@/lib/progress";
import { askHref } from "@/lib/starters";
import { type Entry, findEntry, flatLessons, getTrack, neighbours, trackSummary } from "@/lib/syllabus";

export const runtime = "nodejs";
export const dynamicParams = false;

type Params = { params: Promise<{ track: string; slug: string }> };

export function generateStaticParams() {
  return flatLessons().map((e) => ({ track: e.track, slug: e.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { track, slug } = await params;
  const lesson = getLesson(track, slug);
  if (!lesson) return { title: "Lesson · cairnly" };
  return {
    title: `${lesson.title} · cairnly`,
    description: `${lesson.title}: a ${lesson.difficulty}, ${lesson.estimatedMinutes}-minute lesson in ${getTrack(track)?.title ?? track} on cairnly.`,
  };
}

function askUrl(title: string, track: string): string {
  return askHref(`Explain the main ideas of "${title}"`, track);
}

function NeighbourCard({ entry, label, currentTrack }: { entry?: Entry; label: string; currentTrack: string }) {
  if (!entry) return <div className="hidden sm:block" />;
  const lesson = getLesson(entry.track, entry.slug);
  if (!lesson) return <div className="hidden sm:block" />;
  const otherTrack = entry.track !== currentTrack ? getTrack(entry.track)?.title : undefined;
  const next = label === "Next";
  return (
    <Card href={`/${entry.track}/${entry.slug}`} className={`flex flex-col p-4 ${next ? "sm:items-end sm:text-right" : ""}`}>
      <span className="eyebrow text-faint">{next ? "Next →" : "← Previous"}</span>
      <span className="mt-1.5 font-semibold text-text">{lesson.title}</span>
      <span className={`mt-3 flex flex-wrap gap-2 ${next ? "sm:justify-end" : ""}`}>
        <DifficultyBadge difficulty={lesson.difficulty} />
        <DurationBadge minutes={lesson.estimatedMinutes} />
      </span>
      {otherTrack && <span className="mt-2 text-xs text-muted">Continues in {otherTrack}</span>}
    </Card>
  );
}

export default async function LessonPage({ params }: Params) {
  const { track: trackId, slug } = await params;
  const lesson = getLesson(trackId, slug);
  const track = getTrack(trackId);
  const entry = findEntry(trackId, slug);
  if (!lesson || !track || !entry) notFound();

  const summary = trackSummary(track);
  const navTrack: NavTrack = {
    id: summary.id,
    title: summary.title,
    modules: summary.modules.map((m) => ({ title: m.title, lessons: m.lessons.map((l) => ({ slug: l.slug, title: l.title })) })),
  };
  const nav = <TrackNav track={navTrack} active={slug} />;
  const { prev, next } = neighbours(trackId, slug);
  const content = await renderMdx(lesson.body, mdxComponents);
  const hasChecklist = lesson.body.includes("<CompletionChecklist");

  const header = (
    <header>
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
        <Link href="/syllabus" className="shrink-0 hover:text-text">Learn</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/${track.id}`} className="shrink-0 hover:text-text">{track.title}</Link>
        <span aria-hidden="true">›</span>
        <Link href={`/${track.id}#${slugify(entry.module)}`} className="min-w-0 truncate hover:text-text">{entry.module}</Link>
        <span aria-hidden="true" className="hidden sm:inline">›</span>
        <span aria-current="page" className="hidden min-w-0 truncate sm:inline">{lesson.title}</span>
      </nav>
      <h1 className="text-display mt-5">{lesson.title}</h1>
      <div className="mt-5 flex flex-wrap gap-2">
        <Badge>{entry.module}</Badge>
        <DifficultyBadge difficulty={lesson.difficulty} />
        <DurationBadge minutes={lesson.estimatedMinutes} />
      </div>
      <Link
        href={askUrl(lesson.title, track.id)}
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-strong"
      >
        <MessageCircle size={15} aria-hidden="true" />
        Ask cairnly about this lesson
      </Link>
    </header>
  );

  return (
    <LessonScope lessonKey={lessonKey(trackId, slug)}>
      <ReadingLayout
        header={header}
        outline={pageOutline(lesson.body, sectionTitles())}
        leftNav={<ScrollToActive className="relative h-full overflow-y-auto">{nav}</ScrollToActive>}
        mobileNav={<LessonDrawer>{nav}</LessonDrawer>}
        footer={
          <>
            {!hasChecklist && (
              <div className="mt-10 border-t border-border pt-6">
                <MarkDone />
              </div>
            )}
            <nav aria-label="Previous and next lesson" className="mt-12 grid gap-3 sm:grid-cols-2">
              <NeighbourCard entry={prev} label="Previous" currentTrack={track.id} />
              <NeighbourCard entry={next} label="Next" currentTrack={track.id} />
            </nav>
          </>
        }
      >
        {content}
      </ReadingLayout>
    </LessonScope>
  );
}
