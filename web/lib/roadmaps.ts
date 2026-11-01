// Roadmap facts the pages show: who each roadmap is for (by front-matter `audience`), the
// time horizon in months and its label.

/** The featured roadmap above the audience groups on /roadmap. */
export const CORE_AUDIENCE = "ai-engineer-path";

export const AUDIENCE_GROUPS = ["Students", "Career switchers", "Working professionals"] as const;
export type AudienceGroup = (typeof AUDIENCE_GROUPS)[number];

/** Lucide icon names; components map them to the icons (lib stays free of React). */
export type PersonaIcon = "GraduationCap" | "Target" | "Sprout" | "Code2" | "Repeat" | "Clock";

export interface Persona {
  audience: string;
  label: string;
  icon: PersonaIcon;
  group: AudienceGroup;
}

/** One persona per non-core roadmap, in display order. */
export const PERSONAS: Persona[] = [
  { audience: "cs-student-2027-2030", label: "Student", icon: "GraduationCap", group: "Students" },
  { audience: "placement-prep", label: "Final-year", icon: "Target", group: "Students" },
  { audience: "beginner", label: "Beginner", icon: "Sprout", group: "Students" },
  { audience: "fullstack-to-ai", label: "Full-stack dev", icon: "Code2", group: "Career switchers" },
  { audience: "career-switcher", label: "Non-AI engineer", icon: "Repeat", group: "Career switchers" },
  { audience: "time-constrained", label: "Working pro, 5 h/week", icon: "Clock", group: "Working professionals" },
];

export function personaOf(audience: string): Persona | undefined {
  return PERSONAS.find((p) => p.audience === audience);
}

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
