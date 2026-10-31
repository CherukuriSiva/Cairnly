// The owner's hand-picked LinkedIn posts, read from content/news/linkedin.yaml.
// Only links are shown. Nothing is fetched from LinkedIn and no LinkedIn script is loaded.

import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { CONTENT_DIR } from "@/lib/content";
import { cleanText, safeUrl } from "./text";

export interface LinkedInPick {
  url: string;
  author: string;
  title: string;
  note: string;
  /** YYYY-MM-DD, or "" when none was given. */
  date: string;
}

const MAX_NOTE = 300;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isLinkedInHost(hostname: string): boolean {
  return hostname === "linkedin.com" || hostname.endsWith(".linkedin.com");
}

/** A string field as clean text. YAML turns a bare date into a Date, so accept that for `date`. */
function field(value: unknown): string {
  return typeof value === "string" ? cleanText(value) : "";
}

function dateField(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "invalid" : value.toISOString().slice(0, 10);
  return field(value);
}

/** One pick, or the reason it was dropped. */
function toPick(entry: unknown): LinkedInPick | string {
  if (!entry || typeof entry !== "object") return "not an object";
  const raw = entry as Record<string, unknown>;
  const url = safeUrl(raw.url);
  if (!url || !url.startsWith("https://") || !isLinkedInHost(new URL(url).hostname)) return "url must be an https linkedin.com link";
  const title = field(raw.title);
  const author = field(raw.author);
  if (!title) return "missing title";
  if (!author) return "missing author";
  const note = field(raw.note);
  if (note.length > MAX_NOTE) return `note is longer than ${MAX_NOTE} characters`;
  const date = dateField(raw.date);
  if (date && !DATE_PATTERN.test(date)) return "date must be YYYY-MM-DD";
  return { url, author, title, note, date };
}

/** Valid picks, newest first. A missing or broken file gives [] with a warning naming the path; bad entries are skipped with a warning. */
export function loadLinkedInPicks(dir: string = CONTENT_DIR): LinkedInPick[] {
  const file = path.join(dir, "news", "linkedin.yaml");
  let entries: unknown;
  try {
    entries = (parse(fs.readFileSync(file, "utf8")) as { picks?: unknown } | null)?.picks;
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    console.warn(missing ? `LinkedIn picks file not found: ${file}` : `LinkedIn picks file could not be read: ${file}`, missing ? "" : error);
    return [];
  }
  if (!Array.isArray(entries)) return [];
  const picks: LinkedInPick[] = [];
  entries.forEach((entry, index) => {
    const pick = toPick(entry);
    if (typeof pick === "string") console.warn(`linkedin.yaml pick ${index} skipped: ${pick}`);
    else picks.push(pick);
  });
  return picks.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
