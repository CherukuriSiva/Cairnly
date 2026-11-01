// Page outlines for the "On this page" list and the roadmap stage list. The MDX is parsed with
// the same remarkAnchors plugin the page renders with (lib/mdx.tsx), so every id here is the id
// the heading really gets, and chat citation anchors stay untouched.

import type { Heading, Root } from "mdast";
import type { MdxJsxFlowElement } from "mdast-util-mdx-jsx";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { attr, componentHeading, remarkAnchors } from "@/lib/anchors";

export interface OutlineItem {
  id: string;
  text: string;
  depth: 2 | 3;
}

export interface Stage {
  id: string;
  title: string;
  duration: string;
}

/** The MDX tree after remarkAnchors has set every heading id and section anchorId. */
export function anchoredTree(body: string, titles: Record<string, string>): Root {
  const processor = unified().use(remarkParse).use(remarkMdx).use(remarkGfm).use(remarkAnchors, { titles });
  return processor.runSync(processor.parse(body)) as Root;
}

/** h2/h3 headings and section components (as level 2), in document order. */
export function pageOutline(body: string, titles: Record<string, string>): OutlineItem[] {
  const items: OutlineItem[] = [];
  visit(anchoredTree(body, titles), (node) => {
    if (node.type === "heading") {
      const heading = node as Heading;
      const id = heading.data?.hProperties?.id;
      if ((heading.depth === 2 || heading.depth === 3) && typeof id === "string") {
        items.push({ id, text: toString(heading), depth: heading.depth });
      }
    } else if (node.type === "mdxJsxFlowElement") {
      const element = node as MdxJsxFlowElement;
      const id = attr(element, "anchorId");
      const text = element.name === "RoadmapPhase" ? attr(element, "title") : componentHeading(element, titles);
      if (id && text) items.push({ id, text, depth: 2 });
    }
  });
  return items;
}

/** A roadmap's stages: each RoadmapPhase's anchor, title and duration, in order. */
export function roadmapStages(body: string, titles: Record<string, string>): Stage[] {
  const stages: Stage[] = [];
  visit(anchoredTree(body, titles), "mdxJsxFlowElement", (element: MdxJsxFlowElement) => {
    if (element.name !== "RoadmapPhase") return;
    stages.push({ id: attr(element, "anchorId") ?? "", title: attr(element, "title") ?? "", duration: attr(element, "duration") ?? "" });
  });
  return stages;
}
