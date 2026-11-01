// Block markdown for chat answers: paragraphs, "-"/"*" and "1." lists, "#" to "###" headings
// and fenced code. Only structure is parsed here; each block's text keeps its inline markdown
// (lib/inline.ts) and "[n]" citations for the renderer, which builds React elements, never HTML.
// An unclosed fence (an answer still streaming) is a code block up to the end.

export type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; lang: string; text: string };

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const CONTINUATION = /^\s{2,}\S/;

export function blockTokens(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(FENCE);
    if (fence) {
      flushParagraph();
      const code: string[] = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ kind: "code", lang: fence[1], text: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      continue;
    }
    const bullet = line.match(BULLET);
    const numbered = bullet ? null : line.match(NUMBERED);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const item = (bullet ?? numbered)![1];
      const last = blocks.at(-1);
      // Items of the same kind continue the list, even across one blank line.
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
      continue;
    }
    const last = blocks.at(-1);
    if (!paragraph.length && last?.kind === "list" && CONTINUATION.test(line) && i > 0 && lines[i - 1].trim()) {
      last.items[last.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}
