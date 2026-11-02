import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { AskForwarder } from "@/components/landing/AskForwarder";
import { HeroAsk } from "@/components/landing/HeroAsk";
import { WarmUp } from "@/components/landing/WarmUp";
import { NewsCard } from "@/components/NewsCard";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PERSONA_ICONS, trackIcon } from "@/components/ui/icons";
import { PebbleWordmark } from "@/components/ui/Logo";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CATEGORY_LABELS, getInsights, getRoadmaps } from "@/lib/content";
import { getNews, latestAcross } from "@/lib/news/fetch";
import { PERSONAS } from "@/lib/roadmaps";
import { askHref, STARTERS } from "@/lib/starters";
import { latestByDate, lessonStats, mixLabel, type DifficultyMix } from "@/lib/stats";
import { getTracks, resolveTrack } from "@/lib/syllabus";
import { SITE_NAME } from "@/lib/site";

// Rebuilt at most once an hour, for the news strip; everything else is build-time content.
export const revalidate = 3600;

const SECTION = "mx-auto max-w-6xl px-4 sm:px-6";

/** A 6px bar split into easy / medium / hard segments by count. */
function MixBar({ mix }: { mix: DifficultyMix }) {
  const total = mix.easy + mix.medium + mix.hard || 1;
  return (
    <div>
      <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-surface-3">
        {(["easy", "medium", "hard"] as const).map((level) => (
          <span key={level} style={{ width: `${(mix[level] / total) * 100}%`, background: `var(--${level})` }} />
        ))}
      </div>
      <span className="sr-only">{mixLabel(mix)}</span>
    </div>
  );
}

function Hero() {
  return (
    <section className={`${SECTION} pb-16 pt-16 sm:pt-24`}>
      <div className="mx-auto max-w-3xl text-center">
        <PebbleWordmark className="text-[2rem] text-text sm:text-[2.5rem]" />
        <p className="eyebrow mt-6 text-accent">AI engineering, one stone at a time</p>
        <h1 className="text-hero mt-4">Find your way into AI engineering</h1>
        <p className="mx-auto mt-5 max-w-[48ch] text-lg text-muted">Lessons, roadmaps and an assistant that cites them.</p>
        <div className="mt-8">
          <HeroAsk />
        </div>
        <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label="Sample questions">
          {STARTERS.map((q) => (
            <li key={q}>
              <Link
                href={askHref(q)}
                className="inline-block rounded-full border border-border bg-surface-1 px-3 py-1.5 text-left text-sm text-muted hover:border-border-strong hover:text-text"
              >
                {q}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Stats({ items }: { items: { value: number; label: string }[] }) {
  return (
    <section aria-label={`${SITE_NAME} in numbers`} className={SECTION}>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col-reverse items-center gap-1 bg-surface-1 px-4 py-5">
            <dt className="eyebrow text-faint">{item.label}</dt>
            <dd className="text-display tabular-nums text-text">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default async function Home() {
  const tracks = getTracks().map(resolveTrack);
  const roadmaps = getRoadmaps();
  const insights = getInsights();
  const trackStats = tracks.map((track) => ({ track, stats: lessonStats(track.modules.flatMap((m) => m.lessons)) }));
  const lessonCount = trackStats.reduce((n, t) => n + t.stats.lessons, 0);
  const latest = latestByDate(insights, 3);
  const news = latestAcross(await getNews(), 4);
  const personas = PERSONAS.flatMap((persona) => {
    const roadmap = roadmaps.find((r) => r.audience === persona.audience);
    return roadmap ? [{ persona, roadmap }] : [];
  });

  return (
    <main className="pb-8">
      <AskForwarder />
      <WarmUp />
      <Hero />
      <Stats
        items={[
          { value: tracks.length, label: "tracks" },
          { value: lessonCount, label: "lessons" },
          { value: roadmaps.length, label: "roadmaps" },
          { value: insights.length, label: "insights" },
        ]}
      />

      <section className={`${SECTION} mt-24`} aria-labelledby="tracks-heading">
        <SectionHeader as="h2" id="tracks-heading" eyebrow="Learn" title="Six tracks, one trail" description="Start with ML Foundations if machine learning is new to you, or jump to the track you need." />
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trackStats.map(({ track, stats }) => {
            const Icon = trackIcon(track.id);
            return (
              <li key={track.id}>
                <Card href={`/syllabus#${track.id}`} className="flex h-full flex-col p-5">
                  <Icon size={22} aria-hidden="true" className="text-accent" />
                  <h3 className="mt-4 text-lg font-semibold text-text">{track.title}</h3>
                  <p className="mt-1 flex-1 text-sm text-muted">{track.tagline}</p>
                  <p className="mt-4 font-mono text-xs text-faint">
                    {stats.lessons} lessons · {stats.hours} h
                  </p>
                  <div className="mt-2">
                    <MixBar mix={stats.mix} />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={`${SECTION} mt-24`} aria-labelledby="personas-heading">
        <SectionHeader as="h2" id="personas-heading" eyebrow="Roadmaps" title="Where are you starting from?" description="Pick the plan that fits your starting point and the time you have." />
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {personas.map(({ persona, roadmap }) => {
            const Icon = PERSONA_ICONS[persona.icon];
            return (
              <li key={persona.audience}>
                <Card href={`/roadmap/${roadmap.slug}`} className="flex h-full items-start gap-4 p-5">
                  <span className="rounded-xl border border-border bg-surface-2 p-2.5 text-accent">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="eyebrow block text-faint">{persona.label}</span>
                    <span className="mt-1 block font-semibold text-text">{roadmap.title}</span>
                  </span>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={`${SECTION} mt-24`} aria-labelledby="insights-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeader as="h2" id="insights-heading" eyebrow="Insights" title="Latest insights" />
          <Link href="/insights" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
            All insights <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {latest.map((insight) => (
            <li key={insight.slug}>
              <Card href={`/insights/${insight.slug}`} className="flex h-full flex-col p-5">
                <div className="flex flex-wrap gap-2">
                  <Badge tone="accent">{CATEGORY_LABELS[insight.category] ?? insight.category}</Badge>
                  <Badge>{insight.readingMinutes} min read</Badge>
                </div>
                <h3 className="mt-4 font-semibold text-text">{insight.title}</h3>
                <p className="mt-2 line-clamp-3 text-sm text-muted">{insight.summary}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {news.length > 0 && (
        <section className={`${SECTION} mt-24`} aria-labelledby="news-heading">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHeader as="h2" id="news-heading" eyebrow="News" title="Fresh from the field" />
            <Link href="/news" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
              All news <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {news.map((item) => (
              <NewsCard key={item.url} source={item.source} date={item.date} title={item.title} url={item.url} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
