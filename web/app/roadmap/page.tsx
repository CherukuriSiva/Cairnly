import { Route } from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PERSONA_ICONS } from "@/components/ui/icons";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { getRoadmaps, sectionTitles, type Roadmap } from "@/lib/content";
import { roadmapStages } from "@/lib/outline";
import { AUDIENCE_GROUPS, CORE_AUDIENCE, horizonLabel, monthsOf, PERSONAS, personaOf } from "@/lib/roadmaps";

export const metadata: Metadata = {
  title: "Roadmaps · cairnly",
  description: "Step-by-step roadmaps into AI engineering for students, career switchers and working professionals.",
};

const LONGEST_MONTHS = 36;

/** A bar scaled to the longest roadmap (36 months), never thinner than 8%. */
function DurationBar({ timeHorizon }: { timeHorizon: string }) {
  const width = Math.max(8, (monthsOf(timeHorizon) / LONGEST_MONTHS) * 100);
  return (
    <div className="flex items-center gap-3">
      <div aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
      </div>
      <span className="shrink-0 font-mono text-xs text-faint">{horizonLabel(timeHorizon)}</span>
    </div>
  );
}

function RoadmapCard({ roadmap, featured = false }: { roadmap: Roadmap; featured?: boolean }) {
  const persona = personaOf(roadmap.audience);
  const Icon = persona ? PERSONA_ICONS[persona.icon] : Route;
  const stages = roadmapStages(roadmap.body, sectionTitles()).length;
  return (
    <Card href={`/roadmap/${roadmap.slug}`} className={`flex h-full flex-col ${featured ? "p-6 sm:p-8" : "p-5"}`}>
      <div className="flex items-center gap-3">
        <span className="rounded-xl border border-border bg-surface-2 p-2.5 text-accent">
          <Icon size={featured ? 22 : 18} aria-hidden="true" />
        </span>
        <span className="eyebrow text-faint">{persona?.label ?? "Core path"}</span>
      </div>
      <h3 className={`mt-4 text-text ${featured ? "text-display-2" : "text-lg font-semibold"}`}>{roadmap.title}</h3>
      <p className={`mt-2 flex-1 text-muted ${featured ? "max-w-[60ch] text-base" : "text-sm"}`}>{roadmap.summary}</p>
      <div className="mt-5 space-y-3">
        <DurationBar timeHorizon={roadmap.timeHorizon} />
        <Badge>{stages} stages</Badge>
      </div>
    </Card>
  );
}

export default function RoadmapsPage() {
  const roadmaps = getRoadmaps();
  const core = roadmaps.find((r) => r.audience === CORE_AUDIENCE);
  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <SectionHeader
        eyebrow="Roadmaps"
        title="Pick your trail"
        description="Step-by-step plans for different starting points and amounts of time. Each stage links to the lessons that cover it."
      />
      {core && (
        <section aria-labelledby="core-heading" className="mt-10">
          <h2 id="core-heading" className="eyebrow text-accent">
            Core path
          </h2>
          <div className="mt-3">
            <RoadmapCard roadmap={core} featured />
          </div>
        </section>
      )}
      {AUDIENCE_GROUPS.map((group) => {
        const inGroup = PERSONAS.filter((p) => p.group === group).flatMap((p) => roadmaps.filter((r) => r.audience === p.audience));
        if (inGroup.length === 0) return null;
        const id = `group-${group.toLowerCase().replace(/\s+/g, "-")}`;
        return (
          <section key={group} aria-labelledby={id} className="mt-12">
            <h2 id={id} className="text-display-2">
              {group}
            </h2>
            <ul className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {inGroup.map((roadmap) => (
                <li key={roadmap.slug}>
                  <RoadmapCard roadmap={roadmap} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
