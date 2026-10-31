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
