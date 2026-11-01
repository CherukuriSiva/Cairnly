import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { DifficultyBadge, DurationBadge } from "@/components/ui/Badge";
import type { LessonSummary } from "@/lib/syllabus";

/** A fixed 16px slot showing a check when the lesson is done, so loading progress never
 * shifts the layout. */
export function DoneSlot({ done }: { done: boolean }) {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
      {done && <CheckCircle2 size={16} className="text-success" aria-label="Done" role="img" />}
    </span>
  );
}

/** One lesson in a syllabus list: number, title link, difficulty, minutes and the done check. */
export function LessonRow({ lesson, number, done }: { lesson: LessonSummary; number: number; done: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
      <span className="w-6 shrink-0 text-right font-mono text-xs text-faint" aria-hidden="true">
        {number}
      </span>
      <Link href={`/${lesson.track}/${lesson.slug}`} className="min-w-0 flex-1 basis-48 text-text hover:text-accent">
        {lesson.title}
      </Link>
      <span className="ml-9 flex items-center gap-2 sm:ml-0">
        <DifficultyBadge difficulty={lesson.difficulty} />
        <DurationBadge minutes={lesson.estimatedMinutes} />
        <DoneSlot done={done} />
      </span>
    </li>
  );
}
