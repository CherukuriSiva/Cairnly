import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { mdxComponents } from "@/components/mdx";
import { LessonDrawer } from "@/components/lesson/LessonDrawer";
import { TrackNav } from "@/components/lesson/TrackNav";
import { slugify } from "@/lib/anchors";
import { getLesson } from "@/lib/content";
import { renderMdx } from "@/lib/mdx";
import { type Entry, findEntry, flatLessons, getTrack, neighbours, resolveTrack } from "@/lib/syllabus";

export const runtime = "nodejs";
export const dynamicParams = false;

type Params = { params: Promise<{ track: string; slug: string }> };

export function generateStaticParams() {
  return flatLessons().map((e) => ({ track: e.track, slug: e.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { track, slug } = await params;
  return { title: `${getLesson(track, slug)?.title ?? "Lesson"} · cairnly` };
}

function askUrl(title: string, track: string): string {
  const q = encodeURIComponent(`Explain the main ideas of "${title}"`);
  return `/?q=${q}&track=${track}`;
}

function NeighbourCard({ entry, label, currentTrack }: { entry?: Entry; label: string; currentTrack: string }) {
  if (!entry) return <div className="hidden sm:block" />;
  const lesson = getLesson(entry.track, entry.slug);
  const otherTrack = entry.track !== currentTrack ? getTrack(entry.track)?.title : undefined;
  return (
    <Link
      href={`/${entry.track}/${entry.slug}`}
      className={`rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 hover:border-[var(--accent)] ${
        label === "Next" ? "sm:text-right" : ""
      }`}
    >
      <span className="block text-xs text-[var(--muted)]">{label}</span>
      <span className="mt-1 block font-semibold">{lesson?.title}</span>
      {otherTrack && <span className="mt-1 block text-xs text-[var(--muted)]">{otherTrack}</span>}
    </Link>
  );
}

export default async function LessonPage({ params }: Params) {
  const { track: trackId, slug } = await params;
  const lesson = getLesson(trackId, slug);
  const track = getTrack(trackId);
  const entry = findEntry(trackId, slug);
  if (!lesson || !track || !entry) notFound();

  const nav = <TrackNav track={resolveTrack(track)} active={slug} />;
  const { prev, next } = neighbours(trackId, slug);
  const content = await renderMdx(lesson.body, mdxComponents);

  return (
    <div className="mx-auto flex max-w-7xl">
      <aside
        className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-72 shrink-0 overflow-y-auto border-r lg:block"
        style={{ borderColor: "var(--line)", background: "var(--panel)" }}
      >
        {nav}
      </aside>

      <main className="mx-auto w-full min-w-0 max-w-3xl px-4 py-8 sm:px-8">
        <LessonDrawer>{nav}</LessonDrawer>

        <nav aria-label="Breadcrumb" className="text-xs" style={{ color: "var(--muted)" }}>
          <Link href="/syllabus" className="hover:underline">Syllabus</Link>
          {" › "}
          <Link href={`/${track.id}`} className="hover:underline">{track.title}</Link>
          {" › "}
          <Link href={`/${track.id}#${slugify(entry.module)}`} className="hover:underline">
            {entry.module}
          </Link>
          {" › "}
          <span>{lesson.title}</span>
        </nav>

        <header className="mt-4">
          <h1 className="text-3xl font-bold tracking-tight">{lesson.title}</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
            {entry.module} · {lesson.difficulty} · {lesson.estimatedMinutes} min
          </p>
          <Link
            href={askUrl(lesson.title, track.id)}
            className="mt-4 inline-block rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
          >
            Ask cairnly about this lesson
          </Link>
        </header>

        <article className="mt-8">{content}</article>

        <nav aria-label="Previous and next lesson" className="mt-12 grid gap-3 sm:grid-cols-2">
          <NeighbourCard entry={prev} label="Previous" currentTrack={track.id} />
          <NeighbourCard entry={next} label="Next" currentTrack={track.id} />
        </nav>
      </main>
    </div>
  );
}
