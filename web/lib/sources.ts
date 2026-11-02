// An answer's sources grouped by document: a page cited for five sections becomes one card
// with five section chips, and every chip keeps its [n] so the inline markers still match.
import type { Source } from "./ask";

export interface SourceGroup {
  path: string;
  title: string;
  /** The page without a section anchor; "" when the source has no page. */
  href: string;
  /** The cited sections in source order, each with its own number and anchor link. */
  sections: Source[];
}

/** One group per document path, in the order each document first appears. */
export function groupSources(sources: Source[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const source of sources) {
    const group = groups.get(source.path);
    if (group) {
      group.sections.push(source);
      group.href ||= source.url.split("#")[0];
    } else {
      groups.set(source.path, { path: source.path, title: source.title, href: source.url.split("#")[0], sections: [source] });
    }
  }
  return [...groups.values()];
}

/** The chip text for a section: the last heading of its trail ("The core idea > Retrieve" →
 * "Retrieve"), or "Introduction" for text before the first heading. */
export function sectionLabel(trail: string): string {
  return trail.split(" > ").at(-1)?.trim() || "Introduction";
}
