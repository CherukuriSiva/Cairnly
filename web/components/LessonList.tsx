import Link from "next/link";
import type { Lesson } from "@/lib/content";

/** A module's lessons with minutes and difficulty, used by the syllabus and track pages. */
export function LessonList({ lessons }: { lessons: Lesson[] }) {
  return (
    <ul className="mt-2 divide-y" style={{ borderColor: "var(--line)" }}>
      {lessons.map((lesson) => (
        <li key={lesson.slug} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
          <Link href={`/${lesson.track}/${lesson.slug}`} className="hover:text-[var(--accent)]">
            {lesson.title}
          </Link>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {lesson.estimatedMinutes} min · {lesson.difficulty}
          </span>
        </li>
      ))}
    </ul>
  );
}
