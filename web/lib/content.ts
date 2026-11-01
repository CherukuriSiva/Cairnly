// Build-time access to the MDX content in ../content (the same files `cairnly ingest` indexes).
// Only server code imports this: pages are statically generated at build time. The exceptions
// are the hourly pages (/ and /news) and the root layout around them, which re-read content on
// each ISR refresh (so the web image ships content/, see web/Dockerfile and next.config.ts).

import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export const CONTENT_DIR = path.join(process.cwd(), "..", "content");

export interface Lesson {
  track: string;
  slug: string;
  title: string;
  difficulty: string;
  estimatedMinutes: number;
  body: string;
}

export interface Insight {
  category: string;
  slug: string;
  title: string;
  summary: string;
  /** YYYY-MM-DD, or "" when the front matter has none. */
  publishedAt: string;
  readingMinutes: number;
  body: string;
}

export interface Roadmap {
  slug: string;
  title: string;
  summary: string;
  /** Who it is for (lib/roadmaps.ts maps it to a persona). */
  audience: string;
  timeHorizon: string;
  body: string;
}

const WORDS_PER_MINUTE = 220;

/** Reading time of an MDX body in whole minutes, at least 1. */
export function readingMinutes(body: string): number {
  const words = body.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Every .mdx file under a folder, as paths relative to it, sorted. */
export function mdxFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(".mdx")) out.push(child);
    }
  };
  walk("");
  return out.sort();
}

function read(kind: string): { data: Record<string, unknown>; body: string; rel: string }[] {
  const dir = path.join(CONTENT_DIR, kind);
  return mdxFiles(dir).map((rel) => {
    const { data, content } = matter(fs.readFileSync(path.join(dir, rel), "utf8"));
    return { data, body: content, rel };
  });
}

const text = (value: unknown): string => (value == null ? "" : String(value));

let lessons: Lesson[] | undefined;
let insights: Insight[] | undefined;
let roadmaps: Roadmap[] | undefined;

export function getLessons(): Lesson[] {
  lessons ??= read("lessons").map(({ data, body }) => ({
    track: text(data.track),
    slug: text(data.slug),
    title: text(data.title),
    difficulty: text(data.difficulty),
    estimatedMinutes: Number(data.estimatedMinutes ?? 0),
    body,
  }));
  return lessons;
}

export function getInsights(): Insight[] {
  insights ??= read("insights").map(({ data, body }) => ({
    category: text(data.category),
    slug: text(data.slug),
    title: text(data.title),
    summary: text(data.summary),
    // YAML reads an unquoted date as a Date.
    publishedAt: data.publishedAt instanceof Date ? data.publishedAt.toISOString().slice(0, 10) : text(data.publishedAt),
    readingMinutes: readingMinutes(body),
    body,
  }));
  return insights;
}

export function getRoadmaps(): Roadmap[] {
  roadmaps ??= read("roadmaps").map(({ data, body }) => ({
    slug: text(data.slug),
    title: text(data.title),
    summary: text(data.summary),
    audience: text(data.audience),
    timeHorizon: text(data.timeHorizon),
    body,
  }));
  return roadmaps;
}

export function getLesson(track: string, slug: string): Lesson | undefined {
  return getLessons().find((l) => l.track === track && l.slug === slug);
}

export function getInsight(slug: string): Insight | undefined {
  return getInsights().find((i) => i.slug === slug);
}

export function getRoadmap(slug: string): Roadmap | undefined {
  return getRoadmaps().find((r) => r.slug === slug);
}

/** Component name -> heading text, shared with the Python converter (content/sections.json). */
export function sectionTitles(): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, "sections.json"), "utf8"));
}

// Insight category labels for the /insights index.
export const CATEGORY_LABELS: Record<string, string> = {
  "ai-engineering": "AI Engineering",
  "ai-systems": "AI Systems & MLOps",
  "full-stack": "Full-Stack",
  career: "Career",
  "industry-signal": "Industry Signals",
};
