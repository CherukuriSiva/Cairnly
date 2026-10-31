import fs from "node:fs";
import path from "node:path";
import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { collectAnchors, remarkAnchors, slugger, slugify } from "@/lib/anchors";
import { sectionTitles } from "@/lib/content";

interface Case {
  name: string;
  mdx: string;
  anchors: string[];
}

const fixture: Case[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "..", "tests", "fixtures", "anchors.json"), "utf8"),
);

function anchorsOf(mdx: string): string[] {
  const processor = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(remarkGfm)
    .use(remarkAnchors, { titles: sectionTitles() });
  const tree = processor.runSync(processor.parse(mdx)) as Root;
  return collectAnchors(tree);
}

describe("anchor fixture shared with Python (tests/fixtures/anchors.json)", () => {
  it.each(fixture.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(anchorsOf(c.mdx)).toEqual(c.anchors);
  });
});

describe("slugify", () => {
  it("follows the shared rule", () => {
    expect(slugify("Run it with `asyncio.gather`")).toBe("run-it-with-asyncio-gather");
    expect(slugify("See [the docs](https://x.y/z) now")).toBe("see-the-docs-now");
    expect(slugify("  --Hello,  World!--  ")).toBe("hello-world");
    expect(slugify("!!!")).toBe("section");
  });

  it("de-duplicates like GitHub and skips used values", () => {
    const next = slugger();
    expect(["A", "A", "A 1", "A"].map(next)).toEqual(["a", "a-1", "a-1-1", "a-2"]);
  });
});
