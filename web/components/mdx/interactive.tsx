"use client";

// Client-side MDX components: copyable code blocks and mermaid diagrams. The quiz lives in
// quiz.tsx and the saved checklist in checklist.tsx.

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** `pre` override: a header with the file name (a `title="..."` fence meta) or the language,
 * a copy button, and the highlighted code scrolling sideways inside its own box. */
export function CodeBlock({
  children,
  title,
  "data-language": language,
  ...rest
}: React.HTMLAttributes<HTMLPreElement> & { "data-language"?: string; title?: string }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(preRef.current?.textContent ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked (e.g. insecure context): the code is still selectable
    }
  }

  const label = title || (language && language !== "plaintext" ? language : "text");
  return (
    <div className="not-prose my-6 max-w-full overflow-hidden rounded-xl border border-border bg-surface-1">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2">
        <span className={`min-w-0 truncate font-mono text-xs ${title ? "text-text" : "text-muted"}`}>{label}</span>
        <button
          type="button"
          onClick={copy}
          className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-surface-3 ${copied ? "text-accent" : "text-muted"}`}
        >
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
          <span className="sr-only"> code</span>
        </button>
      </div>
      <pre
        ref={preRef}
        data-language={language}
        {...rest}
        tabIndex={0}
        className={`code-block overflow-x-auto py-4 leading-relaxed ${rest.className ?? ""}`}
      >
        {children}
      </pre>
    </div>
  );
}

/** A mermaid diagram: the source stays hidden, the SVG goes into a container React never fills. */
export function Diagram({ children }: { children?: React.ReactNode }) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const source = sourceRef.current?.querySelector("code")?.textContent ?? "";
    let cancelled = false;

    async function draw() {
      if (!source.trim() || !targetRef.current) return;
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({ startOnLoad: false, theme: media.matches ? "dark" : "neutral" });
      const { svg } = await mermaid.render(`mermaid-${Math.random().toString(36).slice(2)}`, source);
      if (!cancelled && targetRef.current) targetRef.current.innerHTML = svg;
    }

    draw();
    media.addEventListener("change", draw);
    return () => {
      cancelled = true;
      media.removeEventListener("change", draw);
    };
  }, []);

  return (
    <div className="not-prose my-8">
      <div ref={sourceRef} hidden>
        {children}
      </div>
      <div ref={targetRef} className="flex justify-center overflow-x-auto" />
    </div>
  );
}
