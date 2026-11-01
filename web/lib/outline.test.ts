import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectAnchors } from "@/lib/anchors";
import { CONTENT_DIR, mdxFiles, sectionTitles } from "@/lib/content";
import { anchoredTree, pageOutline, roadmapStages } from "@/lib/outline";

const titles = sectionTitles();

/** True when `sub` appears in `all` in the same order (not necessarily next to each other). */
function inOrder(sub: string[], all: string[]): boolean {
  let at = 0;
  for (const id of sub) {
    at = all.indexOf(id, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

describe("pageOutline", () => {
  it("uses exactly the ids the page renders, in order, for every content file", () => {
    const files = mdxFiles(CONTENT_DIR);
    expect(files.length).toBeGreaterThan(150);
    for (const rel of files) {
      const body = fs.readFileSync(path.join(CONTENT_DIR, rel), "utf8").replace(/^---[\s\S]*?\n---\n/, "");
      const anchors = collectAnchors(anchoredTree(body, titles));
      const outline = pageOutline(body, titles).map((item) => item.id);
      for (const id of outline) expect(anchors, `${rel}: ${id}`).toContain(id);
      expect(inOrder(outline, anchors), rel).toBe(true);
    }
  });

  it("lists h2 and h3 headings and section components with their visible text", () => {
    const mdx = "# Title\n\n<WhatYouWillLearn>\n- x\n</WhatYouWillLearn>\n\n## The `idea`\n\n### Detail\n\n#### Too deep\n";
    expect(pageOutline(mdx, titles)).toEqual([
      { id: "what-you-will-learn", text: "What you will learn", depth: 2 },
      { id: "the-idea", text: "The idea", depth: 2 },
      { id: "detail", text: "Detail", depth: 3 },
    ]);
  });

  it("shows a roadmap phase by its title while keeping its anchor", () => {
    const mdx = '<RoadmapPhase title="RAG End-to-End" duration="Weeks 11–18">\n- x\n</RoadmapPhase>\n';
    expect(pageOutline(mdx, titles)).toEqual([{ id: "rag-end-to-end-weeks-11-18", text: "RAG End-to-End", depth: 2 }]);
  });
});

describe("roadmapStages", () => {
  it("reads every phase's anchor, title and duration in order", () => {
    const mdx =
      '<RoadmapPhase title="One" duration="4 weeks">\n- a\n</RoadmapPhase>\n\n<RoadmapPhase title="Two">\n- b\n</RoadmapPhase>\n';
    expect(roadmapStages(mdx, titles)).toEqual([
      { id: "one-4-weeks", title: "One", duration: "4 weeks" },
      { id: "two", title: "Two", duration: "" },
    ]);
  });
});
