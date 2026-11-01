// The syllabus (content/syllabus.yaml) is the only source of order: tracks, then named modules,
// then lesson slugs. Sidebars, breadcrumbs, indexes and prev/next all come from here.

import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { CONTENT_DIR, getLesson, type Lesson } from "@/lib/content";

export interface Module {
  title: string;
  lessons: string[];
}

export interface Track {
  id: string;
  title: string;
  tagline: string;
  modules: Module[];
}

/** One lesson's place in the syllabus. */
export interface Entry {
  track: string;
  module: string;
  slug: string;
}

let tracks: Track[] | undefined;

export function getTracks(): Track[] {
  tracks ??= (
    parse(fs.readFileSync(path.join(CONTENT_DIR, "syllabus.yaml"), "utf8")) as { tracks: Track[] }
  ).tracks;
  return tracks;
}

export function getTrack(id: string): Track | undefined {
  return getTracks().find((t) => t.id === id);
}

export interface ResolvedTrack extends Omit<Track, "modules"> {
  modules: { title: string; lessons: Lesson[] }[];
}

/** A track with each slug replaced by its lesson (title, minutes, difficulty, ...). */
export function resolveTrack(track: Track): ResolvedTrack {
  return {
    ...track,
    modules: track.modules.map((m) => ({
      title: m.title,
      lessons: m.lessons.flatMap((slug) => getLesson(track.id, slug) ?? []),
    })),
  };
}

/** What lists and client components need of a lesson (no body). */
export type LessonSummary = Omit<Lesson, "body">;

export interface TrackSummary extends Omit<Track, "modules"> {
  modules: { title: string; lessons: LessonSummary[] }[];
}

/** A resolved track without lesson bodies, small enough to hand to a client component. */
export function trackSummary(track: Track): TrackSummary {
  const resolved = resolveTrack(track);
  return {
    ...resolved,
    modules: resolved.modules.map((m) => ({
      title: m.title,
      lessons: m.lessons.map(({ body: _body, ...lesson }) => lesson),
    })),
  };
}

/** Every lesson in reading order across the whole syllabus. */
export function flatLessons(all: Track[] = getTracks()): Entry[] {
  return all.flatMap((t) =>
    t.modules.flatMap((m) => m.lessons.map((slug) => ({ track: t.id, module: m.title, slug }))),
  );
}

export function findEntry(track: string, slug: string, all: Track[] = getTracks()) {
  return flatLessons(all).find((e) => e.track === track && e.slug === slug);
}

/** The lessons before and after one lesson in the full syllabus order (across tracks). */
export function neighbours(
  track: string,
  slug: string,
  all: Track[] = getTracks(),
): { prev?: Entry; next?: Entry } {
  const list = flatLessons(all);
  const i = list.findIndex((e) => e.track === track && e.slug === slug);
  if (i < 0) return {};
  return { prev: list[i - 1], next: list[i + 1] };
}
