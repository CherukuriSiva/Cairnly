import { describe, expect, it } from "vitest";
import { filterModules, matchesFilter, numberLessons } from "@/lib/syllabusFilter";

const lesson = (title: string, difficulty: string) => ({ title, difficulty });

const modules = numberLessons([
  { title: "Basics", lessons: [lesson("Arrays and Strings", "easy"), lesson("Hash Maps", "medium")] },
  { title: "Graphs", lessons: [lesson("BFS and DFS", "medium"), lesson("Dijkstra", "hard")] },
]);

describe("numberLessons", () => {
  it("numbers lessons across modules in reading order", () => {
    expect(modules.flatMap((m) => m.lessons.map((l) => `${l.number} ${l.lesson.title}`))).toEqual([
      "1 Arrays and Strings",
      "2 Hash Maps",
      "3 BFS and DFS",
      "4 Dijkstra",
    ]);
  });
});

describe("matchesFilter", () => {
  it("matches the title case-insensitively and ignores surrounding spaces", () => {
    expect(matchesFilter(lesson("Hash Maps", "medium"), "  hash ", [])).toBe(true);
    expect(matchesFilter(lesson("Hash Maps", "medium"), "graph", [])).toBe(false);
  });

  it("keeps any of the picked difficulties, or all when none is picked", () => {
    expect(matchesFilter(lesson("x", "hard"), "", ["easy", "hard"])).toBe(true);
    expect(matchesFilter(lesson("x", "medium"), "", ["easy", "hard"])).toBe(false);
    expect(matchesFilter(lesson("x", "medium"), "", [])).toBe(true);
  });
});

describe("filterModules", () => {
  it("keeps numbers and empties modules without matches", () => {
    const result = filterModules(modules, "", ["medium"]);
    expect(result.map((m) => m.lessons.map((l) => l.number))).toEqual([[2], [3]]);
    expect(filterModules(modules, "dijkstra", [])[0].lessons).toEqual([]);
  });
});
