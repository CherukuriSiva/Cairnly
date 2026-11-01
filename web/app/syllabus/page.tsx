import type { Metadata } from "next";
import Link from "next/link";
import { LessonList } from "@/components/LessonList";
import { getTracks, resolveTrack } from "@/lib/syllabus";

export const metadata: Metadata = {
  title: "Syllabus · cairnly",
  description: "Six tracks and every cairnly lesson in reading order, from ML foundations to AI systems, DSA, full-stack and career.",
};

export default function SyllabusPage() {
  const tracks = getTracks().map(resolveTrack);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-3xl font-bold tracking-tight">Syllabus</h1>
      <p className="mt-3" style={{ color: "var(--muted)" }}>
        Six tracks for new graduates who want to become AI engineers. Start with ML Foundations
        if machine learning is new to you, or jump to the track you need. Every lesson is open
        to read, and the chat on the home page answers questions with links back to them.
      </p>
      {tracks.map((track) => {
        const count = track.modules.reduce((n, m) => n + m.lessons.length, 0);
        return (
          <section key={track.id} className="mt-12">
            <h2 className="text-2xl font-semibold">
              <Link href={`/${track.id}`} className="hover:text-[var(--accent)]">
                {track.title}
              </Link>
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
              {track.tagline} · {count} lessons
            </p>
            {track.modules.map((module) => (
              <div key={module.title} className="mt-5">
                <h3 className="font-mono text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
                  {module.title}
                </h3>
                <LessonList lessons={module.lessons} />
              </div>
            ))}
          </section>
        );
      })}
    </main>
  );
}
