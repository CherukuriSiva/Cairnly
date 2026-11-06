"use client";

import { BookOpen, Check, Copy, FileText, Mic, RotateCcw, Route, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Answer } from "@/components/chat/Answer";
import { Feedback } from "@/components/chat/Feedback";
import { useReveal } from "@/components/chat/useReveal";
import { CairnMark } from "@/components/ui/Logo";
import type { Source } from "@/lib/ask";
import { failureTitle } from "@/lib/chat/reducer";
import type { AssistantRow, ErrorRow, UserRow, Vote } from "@/lib/chat/types";
import { fullPageLink } from "@/lib/fullPage";
import { groupSources, sectionLabel, type SourceGroup } from "@/lib/sources";

function sourceIcon(path: string): LucideIcon {
  if (path.startsWith("insights/")) return FileText;
  if (path.startsWith("roadmaps/")) return Route;
  return BookOpen;
}

/** The friendly card shown instead of a raw error, with a Retry button. Screen readers hear
 * its title once through the chat's status region, so the card itself is not a live region. */
function ErrorCard({ row, busy, onRetry }: { row: ErrorRow; busy: boolean; onRetry: () => void }) {
  const { title, text } = failureTitle(row);
  return (
    <div className="mt-3 rounded-xl border border-border bg-surface-2 p-4">
      <p className="font-medium text-text">{title}</p>
      {text && <p className="mt-1 text-sm text-muted">{text}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          disabled={busy && !row.retrying}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface-1 px-3 py-1.5 text-sm text-text hover:border-accent disabled:opacity-50"
        >
          <RotateCcw size={14} aria-hidden="true" />
          Retry
        </button>
        {row.retrying && <span className="text-sm text-muted">Retrying…</span>}
      </div>
    </div>
  );
}

/** Whole seconds since the component mounted, ticking once a second. */
function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

/** Three dots while the answer has not started; after a few seconds, "Waking up… 12s" counting
 * from when the question was sent. Screen readers hear the waking note once, through the chat's
 * status region, so nothing here is announced. */
function Typing({ waking }: { waking: boolean }) {
  const seconds = useElapsedSeconds();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 150, 300].map((delay) => (
          <span key={delay} className="h-1.5 w-1.5 rounded-full bg-faint motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
      {waking ? (
        <span aria-hidden="true">
          Waking up… <span className="font-mono tabular-nums">{seconds}s</span>
          <span className="text-faint"> · the first answer can take up to a minute</span>
        </span>
      ) : (
        <span className="sr-only">Searching the lessons…</span>
      )}
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

/** One cited section: its [n] and heading, linking to the section when it has a page. */
function SectionChip({ source, active }: { source: Source; active: boolean }) {
  const label = sectionLabel(source.trail);
  const body = (
    <>
      <span className="font-mono text-[11px] text-accent">{source.n}</span>
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
  const chip = `inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs ${
    active ? "border-accent text-text" : "border-border text-muted"
  }`;
  return (
    <li className="max-w-full">
      {source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          title={source.trail || undefined}
          aria-label={`Source ${source.n}: ${label} (opens in a new tab)`}
          className={`${chip} hover:border-accent hover:text-text`}
        >
          {body}
        </a>
      ) : (
        <span title={source.trail || undefined} className={chip}>
          {body}
        </span>
      )}
    </li>
  );
}

/** One cited document: its title (linking to the page) and a chip for every cited section, so a
 * page cited five times is one card, not five. */
function SourceCard({ group, active }: { group: SourceGroup; active: number | null }) {
  const Icon = sourceIcon(group.path);
  const lit = group.sections.some((s) => s.n === active);
  return (
    <li className={`min-w-0 rounded-xl border bg-surface-1 px-3 py-2.5 text-sm ${lit ? "border-accent" : "border-border"}`}>
      <span className="flex items-center gap-1.5 font-medium text-text">
        <Icon size={13} aria-hidden="true" className="shrink-0 text-faint" />
        {group.href ? (
          <a href={group.href} target="_blank" rel="noopener noreferrer" className="relative min-w-0 truncate hover:text-accent">
            {group.title}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <span className="min-w-0 truncate">{group.title}</span>
        )}
      </span>
      <ul aria-label={`Cited sections of ${group.title}`} className="mt-2 flex flex-wrap gap-1.5">
        {group.sections.map((s) => (
          <SectionChip key={s.n} source={s} active={active === s.n} />
        ))}
      </ul>
    </li>
  );
}

/** Sets or clears the vote on a saved answer; resolves to whether the API took it. */
export type OnVote = (messageId: number, vote: Vote | null, reason?: string) => Promise<boolean>;

/** One answer: its text (typed out while it streams in), sources (one card per document), the
 * full-page link, Copy, the vote buttons (saved answers, when the API has feedback) and the
 * notes line. `debug` adds the model, best match and rewritten query (?debug=1 or development). */
function AssistantMessage({ row, debug, onVote }: { row: AssistantRow; debug: boolean; onVote?: OnVote }) {
  const [active, setActive] = useState<number | null>(null);
  const { shown, revealing } = useReveal(row.text, row.live);
  const finished = !row.live && !row.cut && !revealing;
  const status = row.refused ? "refused" : finished ? "done" : "streaming";
  const link = fullPageLink({ status, answer: row.text, sources: row.sources });
  const groups = groupSources(row.sources);
  const notes = [
    row.refused && (row.guard ? "Blocked by the safety check" : "Not in the lessons"),
    row.uncited && "No citations, check the sources",
    debug && row.searched && `Searched: ${row.searched}`,
    debug && row.model && `${row.model} · best match ${(row.topSimilarity ?? 0).toFixed(2)}`,
  ].filter(Boolean);
  return (
    <div>
      {shown && <Answer text={shown} onCite={setActive} />}
      {(row.live || revealing) && shown && (
        <span aria-hidden="true" className="motion-safe:animate-pulse text-accent">
          ▍
        </span>
      )}
      {groups.length > 0 && (
        <ul aria-label="Sources" className="mt-4 grid gap-2 sm:grid-cols-2">
          {groups.map((group) => (
            <SourceCard key={group.path} group={group} active={active} />
          ))}
        </ul>
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
          {row.text && <CopyButton text={row.text} />}
          {onVote && row.messageId !== undefined && (
            <Feedback vote={row.vote ?? null} onVote={(vote, reason) => onVote(row.messageId as number, vote, reason)} />
          )}
        </div>
      )}
      {row.notice && <p className="mt-2 text-xs italic text-muted">{row.notice}</p>}
      {finished && notes.length > 0 && <p className="mt-2 text-xs text-faint">{notes.join(" · ")}</p>}
    </div>
  );
}

/** One question and what came back: the reader's bubble, then the answer block (the answer, a
 * cut answer with its error card, or the typing dots while it is in flight). */
export function TurnView({
  question,
  replies,
  pending,
  waking,
  busy,
  debug,
  onRetry,
  onVote,
}: {
  question: UserRow;
  replies: (AssistantRow | ErrorRow)[];
  pending: boolean;
  waking: boolean;
  busy: boolean;
  debug: boolean;
  onRetry: (key: string) => void;
  onVote?: OnVote;
}) {
  const typing = pending && !replies.some((r) => r.kind === "error" || r.text.trim());
  return (
    <article className="space-y-4">
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5 text-[0.9375rem] text-text">
          {question.channel === "voice" && (
            <>
              <Mic size={13} aria-hidden="true" className="mr-1.5 inline -translate-y-px text-faint" />
              <span className="sr-only">Spoken: </span>
            </>
          )}
          {question.text}
        </p>
      </div>
      {(replies.length > 0 || typing) && (
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-1 text-text">
            <CairnMark size={20} />
          </span>
          <div className="min-w-0 flex-1">
            {replies.map((row) =>
              row.kind === "assistant" ? (
                <AssistantMessage key={row.key} row={row} debug={debug} onVote={onVote} />
              ) : (
                <ErrorCard key={row.key} row={row} busy={busy} onRetry={() => onRetry(row.replyTo)} />
              ),
            )}
            {typing && <Typing waking={waking} />}
          </div>
        </div>
      )}
    </article>
  );
}
