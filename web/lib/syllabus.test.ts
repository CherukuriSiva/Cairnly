import { describe, expect, it } from "vitest";
import { getLessons } from "@/lib/content";
import { flatLessons, getTracks, neighbours, type Track } from "@/lib/syllabus";

/** Problems between the lesson files and the syllabus; empty when they agree. */
function syllabusProblems(tracks: Track[], files: { track: string; slug: string }[]): string[] {
  const problems: string[] = [];
  const listed = flatLessons(tracks).map((e) => `${e.track}/${e.slug}`);
  const onDisk = new Set(files.map((f) => `${f.track}/${f.slug}`));
  const seen = new Set<string>();
  for (const key of listed) {
    if (seen.has(key)) problems.push(`listed twice: ${key}`);
    seen.add(key);
    if (!onDisk.has(key)) problems.push(`listed but no file: ${key}`);
  }
  for (const key of onDisk) if (!seen.has(key)) problems.push(`file not in syllabus: ${key}`);
  return problems;
}

describe("syllabus.yaml", () => {
  it("has the six tracks in order", () => {
    expect(getTracks().map((t) => t.id)).toEqual([
      "ml-foundations",
      "ai-engineering",
      "ai-systems",
      "dsa",
      "full-stack",
      "career",
    ]);
  });

  it("lists every lesson file exactly once, and every listed slug has a file", () => {
    expect(syllabusProblems(getTracks(), getLessons())).toEqual([]);
    expect(flatLessons()).toHaveLength(126);
  });

  it("catches a missing, duplicated or unknown lesson", () => {
    const files = [
      { track: "t", slug: "a" },
      { track: "t", slug: "b" },
    ];
    const tracks = (lessons: string[]): Track[] => [
      { id: "t", title: "T", tagline: "", modules: [{ title: "M", lessons }] },
    ];
    expect(syllabusProblems(tracks(["a"]), files)).toEqual(["file not in syllabus: t/b"]);
    expect(syllabusProblems(tracks(["a", "b", "a"]), files)).toEqual(["listed twice: t/a"]);
    expect(syllabusProblems(tracks(["a", "b", "c"]), files)).toEqual(["listed but no file: t/c"]);
  });
});

describe("neighbours", () => {
  it("crosses from the last ml-foundations lesson to the first ai-engineering lesson", () => {
    const { prev, next } = neighbours("ml-foundations", "sklearn-ml-pipeline");
    expect(prev?.slug).toBe("model-evaluation-and-metrics");
    expect(next).toEqual({ track: "ai-engineering", module: "LLM basics", slug: "ai-app-mental-model" });
  });

  it("has no prev on the first lesson and no next on the last", () => {
    const list = flatLessons();
    expect(neighbours(list[0].track, list[0].slug).prev).toBeUndefined();
    const last = list[list.length - 1];
    expect(neighbours(last.track, last.slug).next).toBeUndefined();
  });
});
