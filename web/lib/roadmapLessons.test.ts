import { describe, expect, it } from "vitest";
import { getLesson, getRoadmaps, sectionTitles } from "@/lib/content";
import { roadmapStages } from "@/lib/outline";
import { ROADMAP_LESSONS, stageLessons } from "@/lib/roadmapLessons";

const titles = sectionTitles();

describe("ROADMAP_LESSONS", () => {
  it("maps every stage of every roadmap to 1-5 real lessons", () => {
    for (const roadmap of getRoadmaps()) {
      for (const stage of roadmapStages(roadmap.body, titles)) {
        const lessons = stageLessons(roadmap.slug, stage.title);
        expect(lessons.length, `${roadmap.slug}: ${stage.title}`).toBeGreaterThanOrEqual(1);
        expect(lessons.length, `${roadmap.slug}: ${stage.title}`).toBeLessThanOrEqual(5);
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
});
