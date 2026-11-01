// Icons chosen by content ids: one per track and one per roadmap persona (lib/roadmaps.ts).

import {
  Binary,
  BookOpen,
  Brain,
  Briefcase,
  Clock,
  Code2,
  GraduationCap,
  Layers,
  Repeat,
  Server,
  Sparkles,
  Sprout,
  Target,
  type LucideIcon,
} from "lucide-react";
import type { PersonaIcon } from "@/lib/roadmaps";

const TRACK_ICONS: Record<string, LucideIcon> = {
  "ml-foundations": Brain,
  "ai-engineering": Sparkles,
  "ai-systems": Server,
  dsa: Binary,
  "full-stack": Layers,
  career: Briefcase,
};

export function trackIcon(trackId: string): LucideIcon {
  return TRACK_ICONS[trackId] ?? BookOpen;
}

export const PERSONA_ICONS: Record<PersonaIcon, LucideIcon> = {
  GraduationCap,
  Target,
  Sprout,
  Code2,
  Repeat,
  Clock,
};
