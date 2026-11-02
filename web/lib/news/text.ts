// Turn untrusted feed text into safe plain text. Nothing here returns HTML.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntity(match: string, body: string): string {
  if (body.startsWith("#x") || body.startsWith("#X")) {
    const code = parseInt(body.slice(2), 16);
    return codePoint(code, match);
  }
  if (body.startsWith("#")) {
    return codePoint(parseInt(body.slice(1), 10), match);
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? match;
}

function codePoint(code: number, fallback: string): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return fallback;
  return String.fromCodePoint(code);
}

function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, decodeEntity);
}

/**
 * Strip tags, decode entities, collapse whitespace.
 * Entities are decoded after tags are stripped, and the tag strip runs twice around the decode,
 * so "&lt;script&gt;" (escaped HTML in a feed) also ends up as plain text without tags.
 */
export function cleanText(input: string): string {
  const stripTags = (s: string) => s.replace(/<script[\s\S]*?<\/script\s*>/gi, " ").replace(/<style[\s\S]*?<\/style\s*>/gi, " ").replace(/<[^>]*>/g, " ");
  const text = stripTags(decodeEntities(stripTags(input)));
  return text.replace(/\s+/g, " ").trim();
}

/** Cut at a word boundary so the result is at most `max` characters, adding "…" when cut. */
export function truncate(text: string, max = 200): string {
  if (text.length <= max) return text;
  const room = max - 1;
  const cut = text.slice(0, room);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > room * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s.,;:!?-]+$/, "")}…`;
}

/** The URL when it is http(s), else null. Blocks javascript:, data: and the rest. */
export function safeUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** The host of an http(s) URL without "www." ("github.com"), or "" when it has none. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A date the feed gave, as an ISO string, or "" when it cannot be read. */
export function toIsoDate(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? "" : new Date(time).toISOString();
}
