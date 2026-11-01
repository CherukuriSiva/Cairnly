// Roadmap facts the pages show: the time horizon in months and its label.

/** Months in a front-matter time horizon ("12-months" → 12), or 0 when it has no number. */
export function monthsOf(timeHorizon: string): number {
  const match = timeHorizon.match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

/** "12 months" (or the raw value when it has no number). */
export function horizonLabel(timeHorizon: string): string {
  const months = monthsOf(timeHorizon);
  if (!months) return timeHorizon;
  return `${months} ${months === 1 ? "month" : "months"}`;
}
