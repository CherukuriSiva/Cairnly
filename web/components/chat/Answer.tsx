// Renders a chat answer: block markdown (lib/markdown.ts) with inline markdown (lib/inline.ts)
// and "[n]" citation chips. Everything becomes React elements, never raw HTML, so model output
// cannot inject markup.

import { inlineTokens } from "@/lib/inline";
import { blockTokens } from "@/lib/markdown";

type OnCite = (n: number) => void;

/** Inline markdown runs: **bold**, *italic* and `code`; the rest is plain text. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineTokens(text).map((token, i) => {
        if (token.kind === "bold") return <strong key={i}>{token.text}</strong>;
        if (token.kind === "italic") return <em key={i}>{token.text}</em>;
        if (token.kind === "code")
          return (
            <code key={i} className="rounded bg-surface-3 px-1 font-mono text-[0.9em]">
              {token.text}
            </code>
          );
        return <span key={i}>{token.text}</span>;
      })}
    </>
  );
}

/** Text with "[2]" markers turned into chips that highlight the matching source. */
function Cited({ text, onCite }: { text: string; onCite: OnCite }) {
  return (
    <>
      {text.split(/(\[\d+\])/).map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (!m) return <Inline key={i} text={part} />;
        const n = Number(m[1]);
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCite(n)}
            aria-label={`Source ${n}`}
            className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-1 items-center justify-center rounded bg-surface-3 px-1 font-mono text-[10px] font-medium text-accent hover:bg-accent hover:text-accent-ink"
          >
            {n}
          </button>
        );
      })}
    </>
  );
}

/** The answer as paragraphs, headings, lists and code blocks. */
export function Answer({ text, onCite }: { text: string; onCite: OnCite }) {
  return (
    <div className="space-y-3 text-[0.9375rem] leading-relaxed text-text">
      {blockTokens(text).map((block, i) => {
        switch (block.kind) {
          case "heading": {
            const Tag = block.level === 3 ? "h4" : "h3";
            return (
              <Tag key={i} className="pt-1 font-semibold text-text">
                <Cited text={block.text} onCite={onCite} />
              </Tag>
            );
          }
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List key={i} className={`space-y-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-faint`}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Cited text={item} onCite={onCite} />
                  </li>
                ))}
              </List>
            );
          }
          case "code":
            return (
              <pre key={i} className="max-w-full overflow-x-auto rounded-xl border border-border bg-surface-1 p-3 font-mono text-[13px] leading-relaxed">
                <code>{block.text}</code>
              </pre>
            );
          default:
            return (
              <p key={i} className="whitespace-pre-wrap">
                <Cited text={block.text} onCite={onCite} />
              </p>
            );
        }
      })}
    </div>
  );
}
