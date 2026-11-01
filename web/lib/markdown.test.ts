import { describe, expect, it } from "vitest";
import { blockTokens } from "@/lib/markdown";

describe("blockTokens", () => {
  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    expect(blockTokens("First line\nsecond line\n\nNext paragraph [1].")).toEqual([
      { kind: "paragraph", text: "First line\nsecond line" },
      { kind: "paragraph", text: "Next paragraph [1]." },
    ]);
  });

  it("reads headings up to ###", () => {
    expect(blockTokens("# One\n## Two\n### Three\n#### Four")).toEqual([
      { kind: "heading", level: 1, text: "One" },
      { kind: "heading", level: 2, text: "Two" },
      { kind: "heading", level: 3, text: "Three" },
      { kind: "paragraph", text: "#### Four" },
    ]);
  });

  it("groups bullet and numbered items into lists and keeps inline markdown", () => {
    expect(blockTokens("Steps:\n- **chunk** the text\n* embed it [2]\n\n1. first\n2) second")).toEqual([
      { kind: "paragraph", text: "Steps:" },
      { kind: "list", ordered: false, items: ["**chunk** the text", "embed it [2]"] },
      { kind: "list", ordered: true, items: ["first", "second"] },
    ]);
  });

  it("joins an indented continuation line to the list item above", () => {
    expect(blockTokens("- a long item\n  that wraps\n- next")).toEqual([
      { kind: "list", ordered: false, items: ["a long item that wraps", "next"] },
    ]);
  });

  it("does not take bold text or *args for a bullet", () => {
    expect(blockTokens("**Bold** start\n*args are fine")).toEqual([
      { kind: "paragraph", text: "**Bold** start\n*args are fine" },
    ]);
  });

  it("reads fenced code with its language, and an unclosed fence while streaming", () => {
    expect(blockTokens("Try:\n```python\nprint('<b>hi</b>')\n- not a list\n```\nDone.")).toEqual([
      { kind: "paragraph", text: "Try:" },
      { kind: "code", lang: "python", text: "print('<b>hi</b>')\n- not a list" },
      { kind: "paragraph", text: "Done." },
    ]);
    expect(blockTokens("```\nx = 1")).toEqual([{ kind: "code", lang: "", text: "x = 1" }]);
  });

  it("keeps HTML as plain text for the renderer", () => {
    expect(blockTokens("<script>alert(1)</script>")).toEqual([
      { kind: "paragraph", text: "<script>alert(1)</script>" },
    ]);
  });

  it("returns nothing for an empty answer", () => {
    expect(blockTokens("")).toEqual([]);
  });
});
