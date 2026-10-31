import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LessonList } from "@/components/LessonList";
import { slugify } from "@/lib/anchors";
import { getTrack, getTracks, resolveTrack } from "@/lib/syllabus";

export const dynamicParams = false;

type Params = { params: Promise<{ track: string }> };

export function generateStaticParams() {
  return getTracks().map((t) => ({ track: t.id }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { track } = await params;
  return { title: `${getTrack(track)?.title ?? "Track"} · cairnly` };
}

export default async function TrackPage({ params }: Params) {
  const { track: id } = await params;
  const found = getTrack(id);
  if (!found) notFound();
  const track = resolveTrack(found);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-3xl font-bold tracking-tight">{track.title}</h1>
      <p className="mt-2" style={{ color: "var(--muted)" }}>
        {track.tagline}
      </p>
      {track.modules.map((module) => (
        <section key={module.title} id={slugify(module.title)} className="mt-10 scroll-mt-20">
          <h2 className="text-lg font-semibold">{module.title}</h2>
          <LessonList lessons={module.lessons} />
        </section>
      ))}
    </main>
  );
}
