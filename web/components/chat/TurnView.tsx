"use client";

import { BookOpen, Check, Copy, FileText, RotateCcw, Route, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Answer } from "@/components/chat/Answer";
import { CairnMark } from "@/components/ui/Logo";
import type { AskErrorKind, Source, StreamedTurn } from "@/lib/ask";
import { fullPageLink } from "@/lib/fullPage";

export interface ChatTurn extends StreamedTurn {
  id: number;
  /** The track scope it was asked with, so Retry asks the same way. */
  scope: string | null;
  /** 1 for the first try; Retry and the automatic retry count up. */
  attempt: number;
  sources: Source[];
  searched?: string; // the rewritten query, shown when it differs from the question
  notice?: string;
  errorKind?: AskErrorKind;
  /** The one automatic retry is scheduled. */
  retrying?: boolean;
}

function sourceIcon(path: string): LucideIcon {
  if (path.startsWith("insights/")) return FileText;
  if (path.startsWith("roadmaps/")) return Route;
  return BookOpen;
}

/** The friendly card shown instead of a raw error, with a Retry button. */
function ErrorCard({ turn, busy, onRetry }: { turn: ChatTurn; busy: boolean; onRetry: () => void }) {
  let title: string;
  let text: string | undefined;
  if (turn.errorKind === "waking" || turn.errorKind === "network") {
    if (turn.attempt > 1) {
      title = "cairnly still isn't answering. Please try again in a minute.";
    } else {
      title = "cairnly is waking up";
      text = "This can take a few seconds.";
    }
  } else if (turn.errorKind === "timeout") {
    title = "cairnly didn't answer in time.";
  } else {
    title = turn.meta || "Something went wrong.";
  }
  return (
    <div role="status" className="mt-3 rounded-xl border border-border bg-surface-2 p-4">
      <p className="font-medium text-text">{title}</p>
      {text && <p className="mt-1 text-sm text-muted">{text}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          disabled={busy && !turn.retrying}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 py-1.5 text-sm text-text hover:border-accent disabled:opacity-50"
        >
          <RotateCcw size={14} aria-hidden="true" />
          Retry
        </button>
        {turn.retrying && <span className="text-sm text-muted">Retrying…</span>}
      </div>
    </div>
  );
}

/** Three dots while the answer has not started; the waking note after a few seconds. */
function Typing({ waking }: { waking?: boolean }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted" role="status">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 150, 300].map((delay) => (
          <span key={delay} className="h-1.5 w-1.5 rounded-full bg-faint motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
      <span>{waking ? "Waking up the model, the first answer can take up to a minute…" : <span className="sr-only">Searching the lessons…</span>}</span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked (e.g. insecure context): the answer is still selectable
    }
  }
  return (
    <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text">
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function SourceCard({ source, active }: { source: Source; active: boolean }) {
  const Icon = sourceIcon(source.path);
  const body = (
    <>
      <span className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-surface-3 px-1 font-mono text-[11px] text-accent">
        {source.n}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-medium text-text">
          <Icon size={13} aria-hidden="true" className="shrink-0 text-faint" />
          <span className="truncate">{source.title}</span>
        </span>
        {source.trail && <span className="mt-0.5 block truncate text-xs text-muted">{source.trail}</span>}
      </span>
    </>
  );
  const frame = `flex items-start gap-2.5 rounded-xl border bg-surface-1 px-3 py-2 text-sm ${
    active ? "border-accent" : "border-border"
  }`;
  return (
    <li>
      {source.url ? (
        <a href={source.url} target="_blank" rel="noopener noreferrer" className={`${frame} hover:border-accent`}>
          {body}
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : (
        <div className={frame}>{body}</div>
      )}
    </li>
  );
}

/** One question and its answer: the reader's bubble, then the answer block with its sources,
 * the full-page link, Copy and the meta line, or the error card. */
export function TurnView({ turn, busy, onRetry }: { turn: ChatTurn; busy: boolean; onRetry: () => void }) {
  const [active, setActive] = useState<number | null>(null);
  const link = fullPageLink(turn);
  const streaming = turn.status === "streaming";
  const finished = turn.status === "done" || turn.status === "refused";
  return (
    <article className="space-y-4">
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5 text-[0.9375rem] text-text">
          {turn.question}
        </p>
      </div>
      <div className="flex gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-1 text-text">
          <CairnMark size={20} />
        </span>
        <div className="min-w-0 flex-1">
          {turn.answer ? (
            <Answer text={turn.answer} onCite={setActive} />
          ) : streaming ? (
            <Typing waking={turn.waking} />
          ) : turn.status !== "error" ? (
            <p className="text-sm text-muted">No answer.</p>
          ) : null}
          {streaming && turn.answer && <span aria-hidden="true" className="motion-safe:animate-pulse text-accent">▍</span>}
          {turn.status === "error" && <ErrorCard turn={turn} busy={busy} onRetry={onRetry} />}

          {turn.sources.length > 0 && (
            <ol aria-label="Sources" className="mt-4 grid gap-2 sm:grid-cols-2">
              {turn.sources.map((s) => (
                <SourceCard key={s.n} source={s} active={active === s.n} />
              ))}
            </ol>
          )}
          {finished && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {link && (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${link.label.replace(" →", "")}: ${link.title} (opens in a new tab)`}
                  className="text-sm font-medium text-accent underline decoration-border underline-offset-2 hover:decoration-accent"
                >
                  {link.label}
                </a>
              )}
              {turn.answer && <CopyButton text={turn.answer} />}
            </div>
          )}
          {turn.notice && <p className="mt-2 text-xs italic text-muted">{turn.notice}</p>}
          {turn.meta && turn.status !== "error" && (
            <p className="mt-2 text-xs text-faint">
              {turn.status === "refused" && (turn.guard ? "Blocked by the safety check · " : "Not in the lessons · ")}
              {turn.searched && `Searched: ${turn.searched} · `}
              {turn.meta}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
