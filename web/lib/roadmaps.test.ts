import { describe, expect, it } from "vitest";
import { getRoadmap, getRoadmaps, sectionTitles } from "@/lib/content";
import { roadmapStages } from "@/lib/outline";
import { CORE_AUDIENCE, horizonLabel, monthsOf, PERSONAS, personaOf } from "@/lib/roadmaps";

describe("monthsOf and horizonLabel", () => {
  it("reads the months from a time horizon", () => {
    expect(monthsOf("12-months")).toBe(12);
    expect(monthsOf("3-months")).toBe(3);
    expect(monthsOf("someday")).toBe(0);
    expect(horizonLabel("36-months")).toBe("36 months");
    expect(horizonLabel("1-month")).toBe("1 month");
    expect(horizonLabel("someday")).toBe("someday");
  });

  it("covers the horizons the roadmaps use", () => {
    expect(getRoadmaps().map((r) => monthsOf(r.timeHorizon)).sort((a, b) => a - b)).toEqual([3, 6, 6, 6, 9, 12, 36]);
  });
});

describe("audiences", () => {
  it("gives every roadmap either the core path or exactly one persona", () => {
    for (const roadmap of getRoadmaps()) {
      if (roadmap.audience === CORE_AUDIENCE) continue;
      expect(personaOf(roadmap.audience), roadmap.slug).toBeDefined();
    }
    expect(getRoadmaps().filter((r) => r.audience === CORE_AUDIENCE)).toHaveLength(1);
    expect(new Set(PERSONAS.map((p) => p.audience)).size).toBe(PERSONAS.length);
  });
});

describe("stages", () => {
  it("counts the five stages of the technical path, matching its summary", () => {
    const roadmap = getRoadmap("ai-engineer-technical-path");
    expect(roadmap).toBeDefined();
    expect(roadmapStages(roadmap!.body, sectionTitles())).toHaveLength(5);
    expect(roadmap!.summary).toMatch(/^A 5-stage path/);
  });

  it("counts 27 stages across all roadmaps", () => {
    const total = getRoadmaps().reduce((n, r) => n + roadmapStages(r.body, sectionTitles()).length, 0);
    expect(total).toBe(27);
  });
});
