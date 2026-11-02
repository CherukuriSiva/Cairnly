"use client";

// Client-side MDX components: copyable code blocks and mermaid diagrams. The quiz lives in
// quiz.tsx and the saved checklist in checklist.tsx.

import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Maximize2, X } from "lucide-react";
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

// Mermaid's "base" theme with the site tokens (app/globals.css), per colour scheme.
const DIAGRAM_COLOURS = {
  dark: {
    background: "#141210",
    primaryColor: "#1c1917",
    primaryTextColor: "#f5f5f4",
    primaryBorderColor: "#2dd4bf",
    secondaryColor: "#292524",
    tertiaryColor: "#141210",
    lineColor: "#a8a29e",
    textColor: "#f5f5f4",
  },
  light: {
    background: "#ffffff",
    primaryColor: "#f5f5f4",
    primaryTextColor: "#1c1917",
    primaryBorderColor: "#0f766e",
    secondaryColor: "#e7e5e4",
    tertiaryColor: "#ffffff",
    lineColor: "#57534e",
    textColor: "#1c1917",
  },
};

function diagramTheme(dark: boolean) {
  const geist = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-sans").trim();
  return {
    theme: "base" as const,
    themeVariables: {
      ...DIAGRAM_COLOURS[dark ? "dark" : "light"],
      fontFamily: geist ? `${geist}, ui-sans-serif, system-ui, sans-serif` : "ui-sans-serif, system-ui, sans-serif",
      fontSize: "14px",
    },
    themeCSS: ".node rect, .node polygon, .cluster rect { rx: 10px; ry: 10px; }",
    // Natural width: on a phone the card scrolls instead of shrinking the text.
    flowchart: { useMaxWidth: false },
    er: { useMaxWidth: false },
  };
}

/** Diagrams taller than this are cut off with a fade and an "Expand diagram" button. */
const DIAGRAM_MAX_HEIGHT = 640;

/** A mermaid diagram in the site theme, redrawn when the colour scheme changes. The source
 * stays hidden; the SVG keeps its natural width and the card scrolls sideways on phones. A tall
 * diagram is capped at 640px; "Expand diagram" opens it full size in a dialog. */
export function Diagram({ children }: { children?: React.ReactNode }) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState<{ svg: string; id: string } | null>(null);
  const [tall, setTall] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const source = sourceRef.current?.querySelector("code")?.textContent ?? "";
    let cancelled = false;

    async function draw() {
      if (!source.trim() || !targetRef.current) return;
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({ startOnLoad: false, ...diagramTheme(media.matches) });
      const id = `mermaid-${Math.random().toString(36).slice(2)}`;
      const { svg } = await mermaid.render(id, source);
      if (cancelled || !targetRef.current) return;
      targetRef.current.innerHTML = svg;
      setDrawn({ svg, id });
      setTall((targetRef.current.firstElementChild?.getBoundingClientRect().height ?? 0) > DIAGRAM_MAX_HEIGHT);
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
      <div className="relative">
        <div
          ref={targetRef}
          style={{ maxHeight: DIAGRAM_MAX_HEIGHT }}
          className="overflow-x-auto overflow-y-hidden rounded-2xl border border-border bg-surface-1 p-4 [&>svg]:mx-auto [&>svg]:block [&>svg]:max-w-none"
        />
        {tall && drawn && (
          <div className="pointer-events-none absolute inset-x-px bottom-px flex h-28 items-end justify-center rounded-b-2xl bg-linear-to-t from-surface-1 via-surface-1/90 to-transparent pb-4">
            <ExpandDiagram svg={drawn.svg} id={drawn.id} />
          </div>
        )}
      </div>
    </div>
  );
}

/** The "Expand diagram" button and its dialog: the whole diagram at its natural size, scrolling
 * both ways. The copy gets its own element ids (mermaid scopes its styles by the svg id). */
function ExpandDiagram({ svg, id }: { svg: string; id: string }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-border-strong bg-surface-1 px-3 py-1.5 text-sm text-text shadow-sm hover:border-accent">
        <Maximize2 size={14} aria-hidden="true" />
        Expand diagram
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl sm:inset-6"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
            <Dialog.Title className="eyebrow text-faint">Diagram</Dialog.Title>
            <Dialog.Close aria-label="Close diagram" className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text">
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div
            role="region"
            tabIndex={0}
            aria-label="Diagram, full size"
            className="min-h-0 flex-1 overflow-auto p-4 [&>svg]:mx-auto [&>svg]:block [&>svg]:max-w-none"
            dangerouslySetInnerHTML={{ __html: svg.replaceAll(id, `${id}-full`) }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
