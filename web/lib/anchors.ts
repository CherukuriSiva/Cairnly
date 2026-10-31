// Heading ids for content pages. The rule must match the Python side (src/cairnly/pages.py)
// exactly, because chat citations link to `/<page>#<anchor>` using ids computed there. Both
// sides are tested against tests/fixtures/anchors.json.
//
// slugify: drop link targets, remove backticks and `*`, lowercase, turn every run of characters
// outside [a-z0-9] into "-", trim "-"; an empty result is "section". Headings (h1-h3) and
// section components get ids in document order; repeats get -1, -2, ... (skipping used ids).

import type { Heading, ListItem, Root, Text } from "mdast";
import type { MdxJsxAttribute, MdxJsxFlowElement } from "mdast-util-mdx-jsx";
import { toString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";

export function slugify(text: string): string {
  const plain = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .toLowerCase();
  return plain.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}

/** Hands out unique ids in call order, GitHub style. */
export function slugger(): (text: string) => string {
  const used = new Set<string>();
  return (text) => {
    const base = slugify(text);
    let slug = base;
    for (let n = 1; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return slug;
  };
}

function attr(node: MdxJsxFlowElement, name: string): string | undefined {
  const found = node.attributes.find(
    (a): a is MdxJsxAttribute => a.type === "mdxJsxAttribute" && a.name === name,
  );
  return typeof found?.value === "string" ? found.value : undefined;
}

/** The heading text a component renders, or undefined when it renders no heading. */
export function componentHeading(
  node: MdxJsxFlowElement,
  titles: Record<string, string>,
): string | undefined {
  if (node.name === "RoadmapPhase") {
    const title = attr(node, "title") ?? "";
    const duration = attr(node, "duration");
    return duration ? `${title} (${duration})` : title;
  }
  return node.name ? titles[node.name] : undefined;
}

/**
 * Remark plugin: sets `id` on h1-h3 headings and an `anchorId` attribute on section components
 * (their titles come from content/sections.json), in document order.
 */
export function remarkAnchors(options: { titles: Record<string, string> }) {
  return (tree: Root) => {
    const next = slugger();
    visit(tree, (node) => {
      if (node.type === "heading" && (node as Heading).depth <= 3) {
        const heading = node as Heading;
        const id = next(toString(heading));
        heading.data = { ...heading.data, hProperties: { ...heading.data?.hProperties, id } };
      } else if (node.type === "mdxJsxFlowElement") {
        const element = node as MdxJsxFlowElement;
        const text = componentHeading(element, options.titles);
        if (text !== undefined) {
          element.attributes.push({ type: "mdxJsxAttribute", name: "anchorId", value: next(text) });
        }
      }
    });
  };
}

/** Every anchor a page gets, in order (used by tests). */
export function collectAnchors(tree: Root): string[] {
  const ids: string[] = [];
  visit(tree, (node) => {
    if (node.type === "heading") {
      const id = (node as Heading).data?.hProperties?.id;
      if (typeof id === "string") ids.push(id);
    } else if (node.type === "mdxJsxFlowElement") {
      const id = attr(node as MdxJsxFlowElement, "anchorId");
      if (id) ids.push(id);
    }
  });
  return ids;
}

export const CORRECT_MARK = "✅";

/**
 * Remark plugin: in each <MiniQuiz>, removes the ✅ from the correct option and marks that list
 * item with `data-correct`, so the answer stays hidden until the reader reveals it.
 */
export function remarkQuiz() {
  return (tree: Root) => {
    visit(tree, "mdxJsxFlowElement", (quiz: MdxJsxFlowElement) => {
      if (quiz.name !== "MiniQuiz") return;
      visit(quiz, "listItem", (item: ListItem) => {
        if (!toString(item).includes(CORRECT_MARK)) return;
        visit(item, "text", (t: Text) => {
          if (t.value.includes(CORRECT_MARK)) t.value = t.value.replaceAll(CORRECT_MARK, "").trimEnd();
        });
        item.data = {
          ...item.data,
          hProperties: { ...item.data?.hProperties, "data-correct": "true" },
        };
      });
    });
  };
}
