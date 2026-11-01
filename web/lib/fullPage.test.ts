import { describe, expect, it } from "vitest";
import type { Source } from "./ask";
import { fullPageLink } from "./fullPage";

const src = (n: number, path: string, url: string): Source => ({
  n,
  title: `T${n}`,
  trail: "",
  path,
  lines: [1, 2],
  citation: "",
  url,
});

const sources = [
  src(1, "lessons/a.md", "/rag/a#x"),
  src(2, "insights/b.md", "/insights/b#y"),
  src(3, "roadmaps/c.md", "/roadmap/c#z"),
];
const turn = (answer: string, s = sources, status: "done" | "streaming" | "refused" | "error" = "done") => ({
  status,
  answer,
  sources: s,
});

describe("fullPageLink", () => {
  it("prefers the first cited source over the top-ranked one", () => {
    expect(fullPageLink(turn("See [2] and [1]."))?.href).toBe("/insights/b");
  });

  it("skips citations with no source or no url", () => {
    const s = [src(1, "lessons/a.md", ""), src(2, "lessons/b.md", "/rag/b#q")];
    expect(fullPageLink(turn("[1] [9] [2]", s))?.href).toBe("/rag/b");
  });

  it("falls back to the first source with a url", () => {
    const s = [src(1, "lessons/a.md", ""), src(2, "lessons/b.md", "/rag/b")];
    expect(fullPageLink(turn("No citations.", s))?.title).toBe("T2");
  });

  it("strips the anchor", () => {
    expect(fullPageLink(turn("[1]"))?.href).toBe("/rag/a");
  });

  it("labels by page type", () => {
    expect(fullPageLink(turn("[1]"))?.label).toBe("Read the full lesson →");
    expect(fullPageLink(turn("[2]"))?.label).toBe("Read the full insight →");
    expect(fullPageLink(turn("[3]"))?.label).toBe("Open the roadmap →");
  });

  it("is null for every status but done", () => {
    for (const st of ["streaming", "refused", "error"] as const) {
      expect(fullPageLink(turn("[1]", sources, st))).toBeNull();
    }
  });

  it("is null for an empty answer", () => {
    expect(fullPageLink(turn("  "))).toBeNull();
  });

  it("is null when no source has a url", () => {
    expect(fullPageLink(turn("[1]", [src(1, "lessons/a.md", "")]))).toBeNull();
  });
});
