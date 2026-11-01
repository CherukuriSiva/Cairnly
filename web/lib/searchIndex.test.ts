import { describe, expect, it } from "vitest";
import { buildSearchIndex } from "@/lib/searchIndex";

describe("buildSearchIndex", () => {
  it("lists lessons, roadmaps and insights with links and meta lines", () => {
    const index = buildSearchIndex({
      lessons: [{ track: "dsa", slug: "arrays", title: "Arrays", trackTitle: "DSA" }],
      roadmaps: [{ slug: "beginner", title: "Beginner path", timeHorizon: "6-months" }],
      insights: [{ slug: "glossary", title: "Glossary", category: "ai-engineering" }],
      categoryLabels: { "ai-engineering": "AI Engineering" },
    });
    expect(index).toEqual([
      { type: "lesson", title: "Arrays", href: "/dsa/arrays", meta: "DSA" },
      { type: "roadmap", title: "Beginner path", href: "/roadmap/beginner", meta: "6 months" },
      { type: "insight", title: "Glossary", href: "/insights/glossary", meta: "AI Engineering" },
    ]);
  });

  it("falls back to the raw category id without a label", () => {
    const [item] = buildSearchIndex({
      lessons: [],
      roadmaps: [],
      insights: [{ slug: "x", title: "X", category: "new-thing" }],
      categoryLabels: {},
    });
    expect(item.meta).toBe("new-thing");
  });
});
