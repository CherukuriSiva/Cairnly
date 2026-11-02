import { describe, expect, it } from "vitest";
import type { Source } from "./ask";
import { groupSources, sectionLabel } from "./sources";

const src = (n: number, path: string, trail: string, url: string): Source => ({
  n,
  title: path.split("/").at(-1) ?? path,
  trail,
  path,
  lines: [1, 2],
  citation: "",
  url,
});

describe("groupSources", () => {
  it("puts every section of one document on one card, in first-seen order", () => {
    const groups = groupSources([
      src(1, "insights/ft-vs-rag.mdx", "When to use RAG", "/insights/ft-vs-rag#when-to-use-rag"),
      src(2, "lessons/what-is-rag.mdx", "", "/ai-engineering/what-is-rag"),
      src(3, "insights/ft-vs-rag.mdx", "Costs", "/insights/ft-vs-rag#costs"),
      src(4, "insights/ft-vs-rag.mdx", "Decision > Rule of thumb", "/insights/ft-vs-rag#rule-of-thumb"),
    ]);
    expect(groups.map((g) => g.path)).toEqual(["insights/ft-vs-rag.mdx", "lessons/what-is-rag.mdx"]);
    expect(groups[0].sections.map((s) => s.n)).toEqual([1, 3, 4]);
    expect(groups[0].href).toBe("/insights/ft-vs-rag");
    expect(groups[1].sections.map((s) => s.n)).toEqual([2]);
  });

  it("takes the page link from any section that has one", () => {
    const [group] = groupSources([src(1, "lessons/a.mdx", "A", ""), src(2, "lessons/a.mdx", "B", "/t/a#b")]);
    expect(group.href).toBe("/t/a");
  });

  it("returns [] for no sources", () => {
    expect(groupSources([])).toEqual([]);
  });
});

describe("sectionLabel", () => {
  it("shows the last heading of the trail", () => {
    expect(sectionLabel("The core idea > Retrieve")).toBe("Retrieve");
    expect(sectionLabel("Costs")).toBe("Costs");
  });

  it("names text before the first heading", () => {
    expect(sectionLabel("")).toBe("Introduction");
  });
});
