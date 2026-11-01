"use client";

// Client-side MDX components: copyable code blocks, mermaid diagrams, the quiz reveal and
// clickable checklist boxes. Nothing here saves state: it lives only while the page is open.

import { useEffect, useRef, useState } from "react";

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** `pre` override: language label, copy button and the highlighted code. */
export function CodeBlock({
  children,
  "data-language": language,
  ...rest
}: React.HTMLAttributes<HTMLPreElement> & { "data-language"?: string }) {
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

  return (
    <div className="not-prose my-5 overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)" }}>
      <div
        className="flex items-center justify-between border-b px-4 py-2"
        style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
      >
        <span className="font-mono text-xs" style={{ color: "var(--muted)" }}>
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs"
          style={{ color: copied ? "var(--accent)" : "var(--muted)" }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre
        ref={preRef}
        data-language={language}
        {...rest}
        className={`code-block overflow-x-auto p-4 text-sm leading-relaxed ${rest.className ?? ""}`}
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

/** The quiz: options look neutral until "Reveal answer"; then the correct one is highlighted. */
export function MiniQuiz({
  anchorId,
  title,
  children,
}: {
  anchorId?: string;
  title: string;
  children?: React.ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <section
      className="my-8 rounded-xl border p-5 sm:p-6"
      style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
    >
      <h2
        id={anchorId}
        className="mb-3 scroll-mt-20 text-sm font-semibold uppercase tracking-wider"
        style={{ color: "var(--accent)" }}
      >
        {title}
      </h2>
      <div className="quiz prose prose-sm max-w-none" data-revealed={revealed ? "true" : "false"}>
        {children}
      </div>
      {!revealed && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="mt-3 rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--border)" }}
        >
          Reveal answer
        </button>
      )}
    </section>
  );
}

/** `input` override: task-list items become clickable checkboxes (not saved anywhere). */
export function TaskCheckbox(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { type, checked, disabled: _disabled, ...rest } = props;
  const [on, setOn] = useState(Boolean(checked));
  if (type !== "checkbox") return <input type={type} defaultChecked={checked} {...rest} />;
  return (
    <input
      {...rest}
      type="checkbox"
      checked={on}
      onChange={(e) => setOn(e.target.checked)}
      className="mr-2 h-4 w-4 cursor-pointer align-middle"
      style={{ accentColor: "var(--accent)" }}
    />
  );
}
