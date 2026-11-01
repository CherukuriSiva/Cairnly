import { describe, expect, it } from "vitest";
import { getInsights, readingMinutes } from "@/lib/content";
import { latestByDate, lessonStats, mixLabel } from "@/lib/stats";

describe("lessonStats", () => {
  it("counts lessons, sums minutes to hours and counts the difficulty mix", () => {
    const stats = lessonStats([
      { difficulty: "easy", estimatedMinutes: 30 },
      { difficulty: "medium", estimatedMinutes: 45 },
      { difficulty: "medium", estimatedMinutes: 20 },
      { difficulty: "hard", estimatedMinutes: 0 },
      { difficulty: "unknown", estimatedMinutes: 10 },
    ]);
    expect(stats).toEqual({ lessons: 5, minutes: 105, hours: 1.8, mix: { easy: 1, medium: 2, hard: 1 } });
    expect(mixLabel(stats.mix)).toBe("1 easy, 2 medium, 1 hard");
  });
});

describe("latestByDate", () => {
  it("sorts newest first and breaks ties by title", () => {
    const items = [
      { publishedAt: "2026-01-01", title: "Old" },
      { publishedAt: "2026-06-06", title: "Beta" },
      { publishedAt: "2026-06-06", title: "Alpha" },
    ];
    expect(latestByDate(items, 2).map((i) => i.title)).toEqual(["Alpha", "Beta"]);
  });
});

describe("readingMinutes", () => {
  it("rounds words at 220 per minute, at least one minute", () => {
    expect(readingMinutes("word ".repeat(10))).toBe(1);
    expect(readingMinutes("word ".repeat(660))).toBe(3);
  });

  it("is set on every insight with its publish date", () => {
    for (const insight of getInsights()) {
      expect(insight.readingMinutes).toBeGreaterThanOrEqual(1);
      expect(insight.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
