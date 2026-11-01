// Server-rendered MDX components for lesson, insight and roadmap pages. Heading text comes from
// content/sections.json and every heading gets the `anchorId` set by lib/anchors.ts, so chat
// citations can link straight to a section.

import { Callout, type CalloutVariant } from "@/components/ui/Callout";
import { sectionTitles } from "@/lib/content";

type Children = { children?: React.ReactNode };
type Anchored = Children & { anchorId?: string };

/** The heading text a component shows, from content/sections.json. */
export function titleOf(name: string): string {
  return sectionTitles()[name] ?? name;
}

/** Which callout each boxed section component renders as. */
export const SECTION_VARIANTS = {
  WhatYouWillLearn: "learn",
  WhyThisMatters: "why",
  CommonMistakes: "warning",
  InterviewExplanation: "interview",
  TryItYourself: "tip",
  WhatToDoNext: "tip",
  KeyTakeaways: "summary",
  InsightSummary: "summary",
  ResumeBullet: "summary",
  DebuggingChecklist: "warning",
} as const satisfies Record<string, CalloutVariant>;

export type BoxedSection = keyof typeof SECTION_VARIANTS;

/** Build the component for one boxed section name: its callout, with the heading text from
 * sections.json and the anchor from lib/anchors.ts. */
export function boxed(name: BoxedSection) {
  function Box({ anchorId, children }: Anchored) {
    return (
      <Callout variant={SECTION_VARIANTS[name]} title={titleOf(name)} anchorId={anchorId}>
        {children}
      </Callout>
    );
  }
  Box.displayName = name;
  return Box;
}

/** A short note on an idea from Chip Huyen's "AI Engineering", in our own words. */
export function BookNote({ anchorId, children }: Anchored & { chapter?: string }) {
  return (
    <Callout variant="why" title={titleOf("BookNote")} anchorId={anchorId} label="Book">
      {children}
    </Callout>
  );
}

export function Body({ children }: Children) {
  return <div className="prose prose-reading max-w-none">{children}</div>;
}

export function Code({ children }: Children) {
  return <>{children}</>;
}

export function SourceNote({ children }: Children) {
  return (
    <p
      className="mt-12 border-t pt-4 text-xs italic"
      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
    >
      {children ??
        "Synthesized from recurring industry discussions across professional communities (2026). This is an original summary, not a reproduction of any single post."}
    </p>
  );
}

const QUADRANTS = [
  { key: "now", label: "Learn now" },
  { key: "soon", label: "Learn soon" },
  { key: "later", label: "Learn later" },
  { key: "ignore", label: "Ignore for now" },
] as const;

type Quadrant = (typeof QUADRANTS)[number]["key"];

export function SkillPriorityMatrix({
  anchorId,
  ...lists
}: { anchorId?: string } & Partial<Record<Quadrant, string[]>>) {
  return (
    <section className="my-8">
      <h2 id={anchorId} className="scroll-mt-20 text-xl font-bold tracking-tight">
        {titleOf("SkillPriorityMatrix")}
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {QUADRANTS.map((q) => (
          <div
            key={q.key}
            className="rounded-xl border p-5"
            style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
          >
            <h3
              className="mb-2 text-sm font-semibold uppercase tracking-wider"
              style={{ color: q.key === "ignore" ? "var(--muted)" : "var(--accent)" }}
            >
              {q.label}
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {(lists[q.key] ?? []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RoadmapPhase({
  anchorId,
  title,
  duration,
  children,
}: Anchored & { title: string; duration?: string }) {
  return (
    <section
      className="my-6 rounded-xl border p-5 sm:p-6"
      style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={anchorId} className="scroll-mt-20 text-lg font-bold">
          {title}
        </h2>
        {duration && (
          <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
            {duration}
          </span>
        )}
      </div>
      <div className="prose prose-sm max-w-none">{children}</div>
    </section>
  );
}
