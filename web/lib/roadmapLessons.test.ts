import { describe, expect, it } from "vitest";
import { getLesson, getRoadmaps, sectionTitles } from "@/lib/content";
import { roadmapStages } from "@/lib/outline";
import { firstStone, ROADMAP_LESSONS, stageLessons } from "@/lib/roadmapLessons";

const titles = sectionTitles();

describe("ROADMAP_LESSONS", () => {
  it("lists every stage of every roadmap explicitly, with at most 6 real lessons", () => {
    for (const roadmap of getRoadmaps()) {
      for (const stage of roadmapStages(roadmap.body, titles)) {
        expect(ROADMAP_LESSONS[roadmap.slug]?.[stage.title], `${roadmap.slug}: ${stage.title}`).toBeDefined();
        const lessons = stageLessons(roadmap.slug, stage.title);
        expect(lessons.length, `${roadmap.slug}: ${stage.title}`).toBeLessThanOrEqual(6);
        for (const key of lessons) {
          const [track, slug] = key.split("/");
          expect(getLesson(track, slug), `${roadmap.slug}: ${key}`).toBeDefined();
        }
      }
    }
  });

  it("names only real roadmaps and stages", () => {
    const roadmaps = new Map(getRoadmaps().map((r) => [r.slug, roadmapStages(r.body, titles).map((s) => s.title)]));
    for (const [slug, stages] of Object.entries(ROADMAP_LESSONS)) {
      expect(roadmaps.has(slug), slug).toBe(true);
      for (const stage of Object.keys(stages)) expect(roadmaps.get(slug), `${slug}: ${stage}`).toContain(stage);
    }
  });

  it("has no repeated lesson within a stage", () => {
    for (const stages of Object.values(ROADMAP_LESSONS)) {
      for (const lessons of Object.values(stages)) expect(new Set(lessons).size).toBe(lessons.length);
    }
  });

  it("starts every roadmap with an easy first stone from its first stage, or none", () => {
    for (const roadmap of getRoadmaps()) {
      const stages = roadmapStages(roadmap.body, titles).map((s) => s.title);
      const first = firstStone(roadmap.slug, stages);
      expect(first).toBe(stageLessons(roadmap.slug, stages[0])[0]);
      if (!first) continue;
      const [track, slug] = first.split("/");
      expect(getLesson(track, slug)?.difficulty, `${roadmap.slug}: ${first}`).toBe("easy");
    }
  });

  it("starts the AI engineer path with Python, not an MLOps or API lesson", () => {
    const [first] = stageLessons("ai-engineer-technical-path", "Python + Git + HTTP");
    expect(first).toBe("dsa/arrays-and-frequency-maps");
  });

  it("has no first stone when the first stage has no lessons", () => {
    expect(firstStone("ai-era-beginner-readiness", ["Months 1–2: Programming Fundamentals"])).toBeUndefined();
    expect(firstStone("ai-era-beginner-readiness", [])).toBeUndefined();
  });
});
