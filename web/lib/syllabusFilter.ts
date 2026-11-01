// Numbering and client-side filtering for the syllabus lists.

export interface NumberedLesson<T> {
  lesson: T;
  /** 1-based position within the whole track, kept when filters hide other lessons. */
  number: number;
}

/** Number every lesson of a track in reading order across its modules. */
export function numberLessons<T>(modules: { title: string; lessons: T[] }[]): { title: string; lessons: NumberedLesson<T>[] }[] {
  let n = 0;
  return modules.map((m) => ({ title: m.title, lessons: m.lessons.map((lesson) => ({ lesson, number: ++n })) }));
}

/** True when the title contains the query (case-insensitive) and, if any difficulty is
 * picked, the lesson has one of them. */
export function matchesFilter(
  lesson: { title: string; difficulty: string },
  query: string,
  difficulties: readonly string[],
): boolean {
  const q = query.trim().toLowerCase();
  if (q && !lesson.title.toLowerCase().includes(q)) return false;
  return difficulties.length === 0 || difficulties.includes(lesson.difficulty);
}

/** The modules with only the matching lessons left (a module may end up empty). */
export function filterModules<T extends { title: string; difficulty: string }>(
  modules: { title: string; lessons: NumberedLesson<T>[] }[],
  query: string,
  difficulties: readonly string[],
): { title: string; lessons: NumberedLesson<T>[] }[] {
  return modules.map((m) => ({ title: m.title, lessons: m.lessons.filter(({ lesson }) => matchesFilter(lesson, query, difficulties)) }));
}
