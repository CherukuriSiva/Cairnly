"use client";

import Link from "next/link";
import { ProgressMeter } from "@/components/progress/ProgressMeter";
import { useProgress } from "@/components/progress/useProgress";
import { DoneSlot } from "@/components/syllabus/LessonRow";
import { doneCount, isDone, lessonKey } from "@/lib/progress";

export interface NavTrack {
  id: string;
  title: string;
  modules: { title: string; lessons: { slug: string; title: string }[] }[];
}

/** One track's modules and lessons, with the current lesson highlighted, a done check per
 * lesson and the track's progress. Used by the desktop sidebar and the mobile drawer. */
export function TrackNav({ track, active }: { track: NavTrack; active: string }) {
  const progress = useProgress();
  const keys = track.modules.flatMap((m) => m.lessons.map((l) => lessonKey(track.id, l.slug)));
  return (
    <nav aria-label={`${track.title} lessons`} className="space-y-5 p-4">
      <div className="px-3">
        <Link href={`/${track.id}`} className="font-mono text-xs text-muted hover:text-text">
          ← {track.title}
        </Link>
        <ProgressMeter done={doneCount(progress, keys)} total={keys.length} className="mt-3" />
      </div>
      {track.modules.map((module) => (
        <div key={module.title}>
          <p className="eyebrow px-3 py-1 text-[10px] text-faint">{module.title}</p>
          <ul className="mt-1 space-y-0.5">
            {module.lessons.map((lesson) => {
              const current = lesson.slug === active;
              return (
                <li key={lesson.slug}>
                  <Link
                    href={`/${track.id}/${lesson.slug}`}
                    aria-current={current ? "page" : undefined}
                    className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                      current ? "bg-surface-2 font-semibold text-accent" : "text-muted hover:text-text"
                    }`}
                  >
                    <span className="min-w-0 flex-1">{lesson.title}</span>
                    <span className="mt-0.5">
                      <DoneSlot done={isDone(progress, lessonKey(track.id, lesson.slug))} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
