import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrackProgress } from "@/components/progress/TrackProgress";
import { ModuleList } from "@/components/syllabus/ModuleList";
import { trackIcon } from "@/components/ui/icons";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { lessonKey } from "@/lib/progress";
import { lessonStats } from "@/lib/stats";
import { getTrack, getTracks, trackSummary } from "@/lib/syllabus";
import { numberLessons } from "@/lib/syllabusFilter";

export const dynamicParams = false;

type Params = { params: Promise<{ track: string }> };

export function generateStaticParams() {
  return getTracks().map((t) => ({ track: t.id }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { track } = await params;
  const found = getTrack(track);
  return { title: `${found?.title ?? "Track"} · cairnly`, description: found?.tagline };
}

export default async function TrackPage({ params }: Params) {
  const { track: id } = await params;
  const found = getTrack(id);
  if (!found) notFound();
  const track = trackSummary(found);
  const lessons = track.modules.flatMap((m) => m.lessons);
  const stats = lessonStats(lessons);
  const Icon = trackIcon(track.id);

  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <Icon size={28} aria-hidden="true" className="text-accent" />
      <SectionHeader eyebrow={`Track · ${stats.lessons} lessons · ${stats.hours} h`} title={track.title} description={track.tagline} className="mt-4">
        <TrackProgress keys={lessons.map((l) => lessonKey(l.track, l.slug))} className="mt-6 max-w-xs" />
      </SectionHeader>
      <div className="mt-10">
        <ModuleList modules={numberLessons(track.modules)} anchors />
      </div>
    </main>
  );
}
