// Numbers the landing and syllabus pages show, computed from the content at build time.

export interface DifficultyMix {
  easy: number;
  medium: number;
  hard: number;
}

export interface TrackStats {
  lessons: number;
  minutes: number;
  /** Total time in hours, one decimal. */
  hours: number;
  mix: DifficultyMix;
}

/** Lesson count, total time and difficulty mix of a list of lessons. */
export function lessonStats(lessons: { difficulty: string; estimatedMinutes: number }[]): TrackStats {
  const mix: DifficultyMix = { easy: 0, medium: 0, hard: 0 };
  let minutes = 0;
  for (const lesson of lessons) {
    minutes += lesson.estimatedMinutes;
    if (lesson.difficulty in mix) mix[lesson.difficulty as keyof DifficultyMix]++;
  }
  return { lessons: lessons.length, minutes, hours: Math.round((minutes / 60) * 10) / 10, mix };
}

/** A duration for people: "45 min" under an hour, then hours and minutes ("3h 15m", "2h"). */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** "12 easy, 30 medium, 10 hard" for screen readers. */
export function mixLabel(mix: DifficultyMix): string {
  return `${mix.easy} easy, ${mix.medium} medium, ${mix.hard} hard`;
}

/** The newest items by `publishedAt` (YYYY-MM-DD), ties broken by title. */
export function latestByDate<T extends { publishedAt: string; title: string }>(items: T[], count: number): T[] {
  return [...items]
    .sort((a, b) => (a.publishedAt === b.publishedAt ? a.title.localeCompare(b.title) : a.publishedAt < b.publishedAt ? 1 : -1))
    .slice(0, count);
}
