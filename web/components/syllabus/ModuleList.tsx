"use client";

import { ChevronDown } from "lucide-react";
import { useProgress } from "@/components/progress/useProgress";
import { LessonRow } from "@/components/syllabus/LessonRow";
import type { LessonSummary } from "@/lib/syllabus";
import { slugify } from "@/lib/anchors";
import { isDone, lessonKey } from "@/lib/progress";
import { formatMinutes } from "@/lib/stats";

export interface NumberedModule {
  title: string;
  /** Lessons to show, each with its number within the whole track. */
  lessons: { lesson: LessonSummary; number: number }[];
}

/** A track's modules as collapsible sections (open by default) of lesson rows with done
 * checks. A module with no lessons to show is left out. `anchors` gives each module the id the
 * lesson breadcrumbs link to (only on the track page, where module titles are unique). */
export function ModuleList({ modules, anchors = false }: { modules: NumberedModule[]; anchors?: boolean }) {
  const progress = useProgress();
  return (
    <div className="space-y-3">
      {modules
        .filter((m) => m.lessons.length > 0)
        .map((module) => {
          const minutes = module.lessons.reduce((n, { lesson }) => n + lesson.estimatedMinutes, 0);
          return (
            <details
              key={module.title}
              open
              id={anchors ? slugify(module.title) : undefined}
              className="group scroll-mt-20 rounded-2xl border border-border bg-surface-1 px-4 sm:px-5"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 py-3.5 [&::-webkit-details-marker]:hidden">
                <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-faint transition-transform group-[:not([open])]:-rotate-90" />
                <span className="min-w-0 flex-1 font-semibold text-text">{module.title}</span>
                <span className="shrink-0 font-mono text-xs text-faint">
                  {module.lessons.length} {module.lessons.length === 1 ? "lesson" : "lessons"} · {formatMinutes(minutes)}
                </span>
              </summary>
              <ul className="divide-y divide-border border-t border-border">
                {module.lessons.map(({ lesson, number }) => (
                  <LessonRow
                    key={lesson.slug}
                    lesson={lesson}
                    number={number}
                    done={isDone(progress, lessonKey(lesson.track, lesson.slug))}
                  />
                ))}
              </ul>
            </details>
          );
        })}
    </div>
  );
}
