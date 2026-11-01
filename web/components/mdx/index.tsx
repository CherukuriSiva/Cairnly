// The component map handed to the MDX compiler (lib/mdx.tsx).

import Link from "next/link";
import { Children, cloneElement, isValidElement } from "react";
import { Checklist, TaskCheckbox } from "@/components/mdx/checklist";
import { CodeBlock, Diagram } from "@/components/mdx/interactive";
import { MiniQuiz, QuizOption } from "@/components/mdx/quiz";
import {
  Body,
  BookNote,
  boxed,
  Code,
  RoadmapPhase,
  SECTION_VARIANTS,
  SkillPriorityMatrix,
  SourceNote,
  titleOf,
  type BoxedSection,
} from "@/components/mdx/sections";

/** Internal links stay in the app; external links open in a new tab. */
function ContentLink({ href = "", children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href.startsWith("/") || href.startsWith("#")) {
    return (
      <Link href={href} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}

/** rehype-pretty-code wraps a fence in a <figure> with an optional title <figcaption>; the
 * title moves into the code block's header as the file name. */
function CodeFigure({ children, ...rest }: React.HTMLAttributes<HTMLElement> & { "data-rehype-pretty-code-figure"?: string }) {
  if (rest["data-rehype-pretty-code-figure"] === undefined) return <figure {...rest}>{children}</figure>;
  let title: string | undefined;
  const items = Children.toArray(children);
  for (const child of items) {
    if (isValidElement<{ children?: React.ReactNode; "data-rehype-pretty-code-title"?: string }>(child) && child.type === "figcaption") {
      title = Children.toArray(child.props.children).join("");
    }
  }
  return (
    <>
      {items.map((child) =>
        isValidElement(child) && child.type === "figcaption" ? null : isValidElement<{ title?: string }>(child) && title ? cloneElement(child, { title }) : child,
      )}
    </>
  );
}

/** List items marked by remarkQuiz become quiz option buttons; others render unchanged. */
function ListItem(props: React.LiHTMLAttributes<HTMLLIElement> & { "data-quiz-option"?: string }) {
  if (props["data-quiz-option"] === "true") return <QuizOption {...props} />;
  return <li {...props} />;
}

type Anchored = { anchorId?: string; children?: React.ReactNode };

export const mdxComponents = {
  ...Object.fromEntries((Object.keys(SECTION_VARIANTS) as BoxedSection[]).map((name) => [name, boxed(name)])),
  CompletionChecklist: ({ anchorId, children }: Anchored) => (
    <Checklist anchorId={anchorId} title={titleOf("CompletionChecklist")}>
      {children}
    </Checklist>
  ),
  MiniQuiz: ({ anchorId, children }: Anchored) => (
    <MiniQuiz anchorId={anchorId} title={titleOf("MiniQuiz")}>
      {children}
    </MiniQuiz>
  ),
  BookNote,
  Body,
  Code,
  Diagram,
  SourceNote,
  SkillPriorityMatrix,
  RoadmapPhase,
  a: ContentLink,
  pre: CodeBlock,
  figure: CodeFigure,
  li: ListItem,
  input: TaskCheckbox,
};
