// The component map handed to the MDX compiler (lib/mdx.tsx).

import Link from "next/link";
import { CodeBlock, Diagram, MiniQuiz, TaskCheckbox } from "@/components/mdx/interactive";
import {
  Body,
  BookNote,
  boxed,
  Code,
  RoadmapPhase,
  SkillPriorityMatrix,
  SourceNote,
  titleOf,
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

const BOXED = [
  "WhatYouWillLearn",
  "WhyThisMatters",
  "InterviewExplanation",
  "CommonMistakes",
  "TryItYourself",
  "CompletionChecklist",
  "DebuggingChecklist",
  "ResumeBullet",
  "KeyTakeaways",
  "WhatToDoNext",
  "InsightSummary",
] as const;

export const mdxComponents = {
  ...Object.fromEntries(BOXED.map((name) => [name, boxed(name)])),
  MiniQuiz: ({ anchorId, children }: { anchorId?: string; children?: React.ReactNode }) => (
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
  input: TaskCheckbox,
};
