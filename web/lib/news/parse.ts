// Pure parsers: raw feed text in, safe NewsItem[] out. They return [] on bad input and never throw.

import { XMLParser } from "fast-xml-parser";
import { cleanText, safeUrl, toIsoDate, truncate } from "./text";
import type { NewsItem } from "./types";
import type { Source } from "./sources";

type Origin = Pick<Source, "name" | "group">;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
});

/** fast-xml-parser gives one object for one element and an array for several. */
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Text of a node that may be a string, a number or an object with "#text". */
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node && typeof node === "object" && "#text" in node) return textOf((node as Record<string, unknown>)["#text"]);
  return "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Build a NewsItem, or null when the title or link is unusable. */
function makeItem(origin: Origin, raw: { title: unknown; url: unknown; date: unknown; summary: unknown }): NewsItem | null {
  const title = cleanText(textOf(raw.title));
  const url = safeUrl(raw.url);
  if (!title || !url) return null;
  return {
    id: `${origin.name}:${url}`,
    source: origin.name,
    group: origin.group,
    title,
    url,
    date: toIsoDate(raw.date),
    summary: truncate(cleanText(textOf(raw.summary))),
  };
}

function atomLink(links: unknown): string {
  const all = toArray(links).map(record);
  const alternate = all.find((l) => l["@_rel"] === undefined || l["@_rel"] === "alternate") ?? all[0];
  return alternate ? textOf(alternate["@_href"]) : "";
}

function compact(items: (NewsItem | null)[]): NewsItem[] {
  return items.filter((item): item is NewsItem => item !== null);
}

/** RSS 2.0 or Atom. Also used for arXiv, which is Atom. */
export function parseFeed(text: string, origin: Origin): NewsItem[] {
  try {
    const doc = record(xml.parse(text));
    const channel = record(record(doc.rss).channel);
    const rssItems = toArray(channel.item).map(record);
    if (rssItems.length > 0) {
      return compact(
        rssItems.map((i) =>
          makeItem(origin, {
            title: i.title,
            url: textOf(i.link) || atomLink(i.link),
            date: textOf(i.pubDate) || textOf(i["dc:date"]),
            summary: i.description ?? i["content:encoded"],
          }),
        ),
      );
    }
    const entries = toArray(record(doc.feed).entry).map(record);
    return compact(
      entries.map((e) =>
        makeItem(origin, {
          title: e.title,
          url: atomLink(e.link),
          date: textOf(e.published) || textOf(e.updated),
          summary: e.summary ?? e.content,
        }),
      ),
    );
  } catch {
    return [];
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Hacker News Algolia search: `{ hits: [...] }`. */
export function parseHn(text: string, origin: Origin): NewsItem[] {
  const hits = toArray(record(parseJson(text)).hits as unknown[]);
  return compact(
    hits.map((raw) => {
      const hit = record(raw);
      const id = textOf(hit.objectID);
      const points = typeof hit.points === "number" ? `${hit.points} points on Hacker News` : "";
      return makeItem(origin, {
        title: hit.title,
        url: safeUrl(hit.url) ?? (id ? `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}` : null),
        date: hit.created_at,
        summary: points,
      });
    }),
  );
}

/** Hugging Face daily papers: an array of `{ title, publishedAt, summary, paper: {...} }`. */
export function parseHfPapers(text: string, origin: Origin): NewsItem[] {
  const entries = parseJson(text);
  if (!Array.isArray(entries)) return [];
  return compact(
    entries.map((raw) => {
      const entry = record(raw);
      const paper = record(entry.paper);
      const id = textOf(paper.id);
      return makeItem(origin, {
        title: entry.title ?? paper.title,
        url: id ? `https://huggingface.co/papers/${encodeURIComponent(id)}` : null,
        date: entry.publishedAt ?? paper.publishedAt,
        summary: entry.summary ?? paper.summary,
      });
    }),
  );
}
