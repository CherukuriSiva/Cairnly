import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { mdxComponents } from "@/components/mdx";
import { roadmapPhaseFor } from "@/components/mdx/sections";
import { ReadingLayout } from "@/components/reading/ReadingLayout";
import { Badge } from "@/components/ui/Badge";
import { PERSONA_ICONS } from "@/components/ui/icons";
import { getLesson, getRoadmap, getRoadmaps, sectionTitles } from "@/lib/content";
import { renderMdx } from "@/lib/mdx";
import { pageOutline, roadmapStages } from "@/lib/outline";
import { stageLessons } from "@/lib/roadmapLessons";
import { horizonLabel, personaOf } from "@/lib/roadmaps";
import { pageTitle } from "@/lib/site";

export const runtime = "nodejs";
export const dynamicParams = false;

type Params = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return getRoadmaps().map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const roadmap = getRoadmap(slug);
  return { title: pageTitle(roadmap?.title ?? "Roadmap"), description: roadmap?.summary };
}

/** "Start this roadmap" as the sticky card in the right column (lg and up); below lg the page
 * shows a sticky bottom bar instead. */
function StartCard({ href, lessonTitle }: { href: string; lessonTitle: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-5">
      <p className="eyebrow text-faint">First stone</p>
      <p className="mt-2 text-sm text-text">{lessonTitle}</p>
      <Link
        href={href}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-strong"
      >
        Start this roadmap
        <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </div>
  );
}

export default async function RoadmapPage({ params }: Params) {
  const { slug } = await params;
  const roadmap = getRoadmap(slug);
  if (!roadmap) notFound();
  const titles = sectionTitles();
  const content = await renderMdx(roadmap.body, { ...mdxComponents, RoadmapPhase: roadmapPhaseFor(slug) });
  const stages = roadmapStages(roadmap.body, titles);
  const persona = personaOf(roadmap.audience);
  const PersonaIcon = persona ? PERSONA_ICONS[persona.icon] : null;
  const firstKey = stages.map((s) => stageLessons(slug, s.title)).find((l) => l.length > 0)?.[0];
  const [firstTrack, firstSlug] = firstKey?.split("/") ?? [];
  const first = firstKey ? getLesson(firstTrack, firstSlug) : undefined;
  const startHref = first ? `/${firstTrack}/${firstSlug}` : null;

  const header = (
    <header>
      <p className="eyebrow text-accent">Roadmap · {horizonLabel(roadmap.timeHorizon)}</p>
      <h1 className="text-display mt-3">{roadmap.title}</h1>
      {roadmap.summary && <p className="mt-4 text-lg text-muted">{roadmap.summary}</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        {persona && PersonaIcon ? (
          <Badge tone="accent">
            <PersonaIcon size={12} aria-hidden="true" />
            {persona.label}
          </Badge>
        ) : (
          <Badge tone="accent">Core path</Badge>
        )}
        <Badge>{horizonLabel(roadmap.timeHorizon)}</Badge>
        <Badge>{stages.length} stages</Badge>
      </div>
    </header>
  );

  return (
    <div>
      <ReadingLayout
        header={header}
        outline={pageOutline(roadmap.body, titles)}
        aside={startHref && first ? <StartCard href={startHref} lessonTitle={first.title} /> : undefined}
      >
        {content}
      </ReadingLayout>
      {/* Sticky, not fixed: it rides the bottom of the screen while the roadmap is in view and
          settles in place after the last stage, so it never covers the content or the footer. */}
      {startHref && (
        <div className="sticky bottom-0 z-30 border-t border-border bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
          <Link
            href={startHref}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink hover:bg-accent-strong"
          >
            Start this roadmap
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  );
}
