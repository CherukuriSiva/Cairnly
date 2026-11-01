import type { ListItem, Root } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { describe, expect, it } from "vitest";
import { CORRECT_MARK, remarkQuiz } from "@/lib/anchors";

function items(mdx: string): { text: string; correct: boolean }[] {
  const processor = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkQuiz);
  const tree = processor.runSync(processor.parse(mdx)) as Root;
  const out: { text: string; correct: boolean }[] = [];
  visit(tree, "listItem", (item: ListItem) => {
    out.push({ text: toString(item), correct: item.data?.hProperties?.["data-correct"] === "true" });
  });
  return out;
}

describe("remarkQuiz", () => {
  it("removes the check mark and marks only the correct option", () => {
    const result = items(
      "<MiniQuiz>\n**Q: Pick one**\n\n- A) wrong\n- B) **right** ✅\n- C) also wrong\n</MiniQuiz>\n",
    );
    expect(result).toEqual([
      { text: "A) wrong", correct: false },
      { text: "B) right", correct: true },
      { text: "C) also wrong", correct: false },
    ]);
    expect(result.some((r) => r.text.includes(CORRECT_MARK))).toBe(false);
  });

  it("leaves lists outside a MiniQuiz alone", () => {
    expect(items("- done ✅\n")).toEqual([{ text: "done ✅", correct: false }]);
  });
});

/** The quiz attributes of every list item: [group, index, correct] or null for a non-option. */
function options(mdx: string): ([string, string, boolean] | null)[] {
  const processor = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkQuiz);
  const tree = processor.runSync(processor.parse(mdx)) as Root;
  const out: ([string, string, boolean] | null)[] = [];
  visit(tree, "listItem", (item: ListItem) => {
    const props = item.data?.hProperties ?? {};
    out.push(
      props["data-quiz-option"] === "true"
        ? [String(props["data-quiz-group"]), String(props["data-quiz-index"]), props["data-correct"] === "true"]
        : null,
    );
  });
  return out;
}

describe("remarkQuiz options", () => {
  it("marks every option of a question with its group and index", () => {
    expect(options("<MiniQuiz>\n**Q: one**\n\n- A) no\n- B) yes ✅\n- C) no\n</MiniQuiz>\n")).toEqual([
      ["0", "0", false],
      ["0", "1", true],
      ["0", "2", false],
    ]);
  });

  it("numbers several questions in one quiz independently", () => {
    const mdx =
      "<MiniQuiz>\n**Q1**\n\n- a ✅\n- b\n\n**Q2**\n\n- c\n- d ✅\n\n**Q3**\n\n- e\n- f\n- g ✅\n</MiniQuiz>\n";
    expect(options(mdx)).toEqual([
      ["0", "0", true],
      ["0", "1", false],
      ["1", "0", false],
      ["1", "1", true],
      ["2", "0", false],
      ["2", "1", false],
      ["2", "2", true],
    ]);
  });

  it("leaves a list without a correct option, and lists outside a quiz, unmarked", () => {
    expect(options("<MiniQuiz>\n- a hint\n- another\n</MiniQuiz>\n\n- outside ✅\n")).toEqual([null, null, null]);
  });
});
