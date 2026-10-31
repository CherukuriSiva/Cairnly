import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONTENT_DIR, getInsights, getLessons, getRoadmaps, mdxFiles } from "@/lib/content";
import { getTracks } from "@/lib/syllabus";

const INTERNAL_LINK = /\]\((\/[^)\s]*)\)/g;

/** Every page the site generates. */
function routes(): Set<string> {
  return new Set([
    "/",
    "/syllabus",
    "/roadmap",
    "/insights",
    ...getTracks().map((t) => `/${t.id}`),
    ...getLessons().map((l) => `/${l.track}/${l.slug}`),
    ...getRoadmaps().map((r) => `/roadmap/${r.slug}`),
    ...getInsights().map((i) => `/insights/${i.slug}`),
  ]);
}

/** "file: link" for every internal markdown link that has no generated page. */
function brokenLinks(files: Record<string, string>, known: Set<string>): string[] {
  const broken: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    for (const [, link] of text.matchAll(INTERNAL_LINK)) {
      const target = link.split("#")[0].replace(/(.)\/$/, "$1");
      if (!known.has(target)) broken.push(`${file}: ${link}`);
    }
  }
  return broken;
}

function contentFiles(): Record<string, string> {
  return Object.fromEntries(
    mdxFiles(CONTENT_DIR).map((rel) => [rel, fs.readFileSync(path.join(CONTENT_DIR, rel), "utf8")]),
  );
}

describe("internal links", () => {
  it("all resolve to generated pages", () => {
    const files = contentFiles();
    const count = Object.values(files).reduce((n, t) => n + [...t.matchAll(INTERNAL_LINK)].length, 0);
    expect(count).toBeGreaterThanOrEqual(99);
    expect(brokenLinks(files, routes())).toEqual([]);
  });

  it("reports a broken link", () => {
    const files = { "a.mdx": "See [ok](/syllabus) and [gone](/dsa/no-such-lesson#x)." };
    expect(brokenLinks(files, routes())).toEqual(["a.mdx: /dsa/no-such-lesson#x"]);
  });
});
