// Compile one MDX body to React at build time (server only, Node runtime).
// - remark-gfm: tables and task-list checkboxes
// - remarkAnchors: heading ids shared with the Python citations (lib/anchors.ts)
// - remarkQuiz: hides the quiz answer until the reader reveals it
// - rehype-pretty-code: syntax highlighting with light and dark themes

import { compileMDX } from "next-mdx-remote/rsc";
import type { MDXRemoteProps } from "next-mdx-remote/rsc";
import rehypePrettyCode from "rehype-pretty-code";
import remarkGfm from "remark-gfm";
import { remarkAnchors, remarkQuiz } from "@/lib/anchors";
import { sectionTitles } from "@/lib/content";

export async function renderMdx(
  source: string,
  components: MDXRemoteProps["components"],
): Promise<React.ReactElement> {
  const { content } = await compileMDX({
    source,
    components,
    options: {
      // The content is our own and uses JS expressions for props (e.g. SkillPriorityMatrix
      // arrays); blockDangerousJS stays on.
      blockJS: false,
      mdxOptions: {
        remarkPlugins: [remarkGfm, [remarkAnchors, { titles: sectionTitles() }], remarkQuiz],
        rehypePlugins: [
          [
            rehypePrettyCode,
            { theme: { light: "github-light", dark: "github-dark" }, keepBackground: false },
          ],
        ],
      },
    },
  });
  return content;
}
