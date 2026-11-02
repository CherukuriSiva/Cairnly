// Server-rendered MDX components for lesson, insight and roadmap pages. Heading text comes from
// content/sections.json and every heading gets the `anchorId` set by lib/anchors.ts, so chat
// citations can link straight to a section.

import { Clock, EyeOff, Hourglass, Zap } from "lucide-react";
import Link from "next/link";
import { StoneMarker } from "@/components/roadmap/StoneMarker";
import { DifficultyDot } from "@/components/ui/Badge";
import { Callout, type CalloutVariant } from "@/components/ui/Callout";
import { tint } from "@/components/ui/tokens";
import { getLesson, sectionTitles } from "@/lib/content";
import { stageLessons } from "@/lib/roadmapLessons";
import { formatMinutes } from "@/lib/stats";

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
  { key: "now", label: "Learn now", icon: Zap, tone: "accent" },
  { key: "soon", label: "Learn soon", icon: Clock, tone: "info" },
  { key: "later", label: "Learn later", icon: Hourglass, tone: null },
  { key: "ignore", label: "Ignore for now", icon: EyeOff, tone: null },
] as const;

type Quadrant = (typeof QUADRANTS)[number]["key"];

/** The 2×2 skill board: now (accent), soon (info), later (neutral), ignore (muted). */
export function SkillPriorityMatrix({
  anchorId,
  ...lists
}: { anchorId?: string } & Partial<Record<Quadrant, string[]>>) {
  return (
    <section className="not-prose my-10">
      <h2 id={anchorId} className="text-display-2">
        {titleOf("SkillPriorityMatrix")}
      </h2>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {QUADRANTS.map(({ key, label, icon: Icon, tone }) => {
          const ignore = key === "ignore";
          return (
            <div
              key={key}
              className={`rounded-2xl border border-border p-5 ${tone ? "" : "bg-surface-2"}`}
              style={tone ? { background: tint(tone) } : undefined}
            >
              <h3 className="eyebrow flex items-center gap-2 text-xs font-semibold" style={{ color: tone ? `var(--${tone})` : "var(--muted)" }}>
                <Icon size={14} aria-hidden="true" />
                {label}
              </h3>
              <ul className={`mt-3 list-disc space-y-1.5 pl-5 text-sm marker:text-faint ${ignore ? "text-muted" : "text-text"}`}>
                {(lists[key] ?? []).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A lesson linked from a roadmap stage: difficulty dot, title, minutes. */
function LessonChip({ lessonKey }: { lessonKey: string }) {
  const [track, slug] = lessonKey.split("/");
  const lesson = getLesson(track, slug);
  if (!lesson) return null;
  return (
    <li className="max-w-full">
      <Link
        href={`/${track}/${slug}`}
        className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-surface-1 px-3 py-1.5 text-sm text-text hover:border-accent"
      >
        <DifficultyDot difficulty={lesson.difficulty} />
        <span className="min-w-0 truncate">{lesson.title}</span>
        <span className="shrink-0 font-mono text-xs text-faint">{formatMinutes(lesson.estimatedMinutes)}</span>
      </Link>
    </li>
  );
}

type PhaseProps = Anchored & { title: string; duration?: string };

/** One stage on the roadmap trail: a stone on the rail that fills as the reader reaches it,
 * the duration, the title (keeping its anchor), the stage's notes and its lessons. The first
 * stage stands clear of the intro text, so the trail starts at a stone. */
function TrailStage({ anchorId, title, duration, children, lessons }: PhaseProps & { lessons: string[] }) {
  return (
    <section className="trail-stage relative pb-12 pl-10 last:pb-4 [:not(.trail-stage)+&]:mt-12">
      <span aria-hidden="true" className="trail-rail absolute bottom-0 left-[9px] top-6 w-0.5 bg-border" />
      <StoneMarker />
      {duration && <p className="eyebrow text-accent">{duration}</p>}
      <h2 id={anchorId} className="text-display-2 mt-1">
        {title}
      </h2>
      <div className="prose prose-reading mt-3 max-w-none">{children}</div>
      {lessons.length > 0 && (
        <div className="mt-5">
          <h3 className="eyebrow text-faint">Lessons for this stage</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {lessons.map((key) => (
              <LessonChip key={key} lessonKey={key} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** RoadmapPhase without lessons (any page that is not a roadmap). */
export function RoadmapPhase(props: PhaseProps) {
  return <TrailStage {...props} lessons={[]} />;
}

/** RoadmapPhase for one roadmap: each stage shows its hand-picked lessons (lib/roadmapLessons). */
export function roadmapPhaseFor(roadmapSlug: string) {
  function Phase(props: PhaseProps) {
    return <TrailStage {...props} lessons={stageLessons(roadmapSlug, props.title)} />;
  }
  Phase.displayName = "RoadmapPhase";
  return Phase;
}
