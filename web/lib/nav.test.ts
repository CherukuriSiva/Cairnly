import { describe, expect, it } from "vitest";
import { activeHref } from "@/lib/nav";

const TRACKS = ["ml-foundations", "dsa"];

describe("activeHref", () => {
  it("marks Learn for the syllabus, track pages and lessons", () => {
    expect(activeHref("/syllabus", TRACKS)).toBe("/syllabus");
    expect(activeHref("/dsa", TRACKS)).toBe("/syllabus");
    expect(activeHref("/ml-foundations/feature-engineering", TRACKS)).toBe("/syllabus");
  });

  it("marks the section that owns the path", () => {
    expect(activeHref("/roadmap", TRACKS)).toBe("/roadmap");
    expect(activeHref("/roadmap/beginner", TRACKS)).toBe("/roadmap");
    expect(activeHref("/insights/some-insight", TRACKS)).toBe("/insights");
    expect(activeHref("/news", TRACKS)).toBe("/news");
  });

  it("marks nothing for home, the chat and unknown paths", () => {
    expect(activeHref("/", TRACKS)).toBeUndefined();
    expect(activeHref("/ask", TRACKS)).toBeUndefined();
    expect(activeHref("/newsletter", TRACKS)).toBeUndefined();
    expect(activeHref("/no-such-track", TRACKS)).toBeUndefined();
  });
});
