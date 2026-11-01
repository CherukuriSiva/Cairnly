// Picks the site page behind an answered turn, for the "Read the full lesson" link under it.
import type { PastTurn, Source } from "./ask";

export interface FullPageLink {
  href: string; // our own site path, never an anchor
  label: string;
  title: string;
}

function labelFor(path: string): string {
  if (path.startsWith("insights/")) return "Read the full insight →";
  if (path.startsWith("roadmaps/")) return "Open the roadmap →";
  return "Read the full lesson →";
}

export function fullPageLink(turn: {
  status: PastTurn["status"];
  answer: string;
  sources: Source[];
}): FullPageLink | null {
  if (turn.status !== "done" || turn.answer.trim() === "") return null;
  const usable = turn.sources.filter((s) => s.url);
  if (usable.length === 0) return null;
  const cited = [...turn.answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const first = cited.map((n) => usable.find((s) => s.n === n)).find(Boolean);
  const source = first ?? usable[0];
  return { href: source.url.split("#")[0], label: labelFor(source.path), title: source.title };
}
