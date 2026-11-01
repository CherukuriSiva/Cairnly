"use client";

import { Search, SearchX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ProgressMeter } from "@/components/progress/ProgressMeter";
import { useProgress } from "@/components/progress/useProgress";
import { useScrollSpy } from "@/components/reading/useScrollSpy";
import { ModuleList } from "@/components/syllabus/ModuleList";
import { EmptyState } from "@/components/ui/EmptyState";
import { difficultyTone, tint } from "@/components/ui/tokens";
import { doneCount, lessonKey } from "@/lib/progress";
import { filterModules, numberLessons } from "@/lib/syllabusFilter";
import type { TrackSummary } from "@/lib/syllabus";

const DIFFICULTIES = ["easy", "medium", "hard"] as const;

const keysOf = (track: TrackSummary) => track.modules.flatMap((m) => m.lessons.map((l) => lessonKey(l.track, l.slug)));

/** The whole syllabus: track cards, a sticky track bar, search and difficulty filters, and
 * each track's modules with progress from this browser. */
export function SyllabusBrowser({ tracks }: { tracks: TrackSummary[] }) {
  const progress = useProgress();
  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<string[]>([]);
  const active = useScrollSpy(tracks.map((t) => t.id), "-120px 0px -50% 0px");

  const numbered = useMemo(() => tracks.map((t) => ({ track: t, modules: numberLessons(t.modules) })), [tracks]);
  const filtered = numbered.map(({ track, modules }) => ({ track, modules: filterModules(modules, query, levels) }));
  const matches = filtered.reduce((n, t) => n + t.modules.reduce((m, mod) => m + mod.lessons.length, 0), 0);
  const total = tracks.reduce((n, t) => n + keysOf(t).length, 0);
  const filtering = query.trim() !== "" || levels.length > 0;

  const toggle = (level: string) => setLevels((all) => (all.includes(level) ? all.filter((l) => l !== level) : [...all, level]));

  return (
    <div>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tracks.map((track) => {
          const keys = keysOf(track);
          return (
            <li key={track.id}>
              <a
                href={`#${track.id}`}
                className="flex h-full flex-col rounded-2xl border border-border bg-surface-1 p-4 transition-colors hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)]"
              >
                <span className="font-semibold text-text">{track.title}</span>
                <span className="mt-1 flex-1 font-mono text-xs text-faint">{keys.length} lessons</span>
                <ProgressMeter done={doneCount(progress, keys)} total={keys.length} className="mt-3" />
              </a>
            </li>
          );
        })}
      </ul>

      <nav
        aria-label="Tracks"
        className="sticky top-14 z-20 -mx-4 mt-8 border-b border-border bg-[color-mix(in_srgb,var(--bg)_85%,transparent)] px-4 backdrop-blur-md sm:-mx-6 sm:px-6"
      >
        <ul className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
          {tracks.map((track) => (
            <li key={track.id} className="shrink-0">
              <a
                href={`#${track.id}`}
                aria-current={active === track.id ? "location" : undefined}
                className={`block rounded-full px-3 py-1.5 text-sm whitespace-nowrap ${
                  active === track.id ? "bg-surface-2 text-text" : "text-muted hover:text-text"
                }`}
              >
                {track.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search lessons"
            placeholder="Search lessons"
            className="h-10 w-full rounded-xl border border-border bg-surface-1 pl-9 pr-3 text-sm text-text placeholder:text-faint focus:border-accent"
          />
        </div>
        <div className="flex gap-2" role="group" aria-label="Difficulty">
          {DIFFICULTIES.map((level) => {
            const on = levels.includes(level);
            return (
              <button
                key={level}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(level)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm capitalize ${
                  on ? "border-transparent text-text" : "border-border text-muted hover:text-text"
                }`}
                style={on ? { background: tint(difficultyTone(level), "24%") } : undefined}
              >
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: `var(--${level})` }} />
                {level}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-3 font-mono text-xs text-faint" aria-live="polite">
        {filtering ? `${matches} of ${total} lessons match` : `${total} lessons`}
      </p>

      {filtering && matches === 0 && (
        <div className="mt-6">
          <EmptyState
            icon={SearchX}
            title="No lessons match"
            text="Try another word or clear the difficulty filters."
            action={
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setLevels([]);
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-text hover:border-accent"
              >
                Clear filters
              </button>
            }
          />
        </div>
      )}

      {filtered.map(({ track, modules }) => {
        const keys = keysOf(track);
        const shown = modules.some((m) => m.lessons.length > 0);
        return (
          <section key={track.id} id={track.id} aria-labelledby={`${track.id}-title`} className={`mt-12 scroll-mt-32 ${shown ? "" : "hidden"}`}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id={`${track.id}-title`} className="text-display-2">
                  <Link href={`/${track.id}`} className="hover:text-accent">
                    {track.title}
                  </Link>
                </h2>
                <p className="mt-1 text-sm text-muted">{track.tagline}</p>
              </div>
              <ProgressMeter done={doneCount(progress, keys)} total={keys.length} className="w-40" />
            </div>
            <div className="mt-5">
              <ModuleList modules={modules} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
