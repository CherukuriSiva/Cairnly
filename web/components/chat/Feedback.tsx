"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Vote } from "@/lib/chat/types";

export const MAX_REASON_CHARS = 300; // the API's limit

/**
 * Thumbs up and down under a saved answer. A click shows at once (aria-pressed) and is undone if
 * the API refuses it; clicking the pressed thumb clears the vote. Thumbs down opens a small,
 * optional "what was wrong" box: focus moves into it, Escape closes it and returns focus to the
 * thumb. Only shown when the API has the feedback feature and the answer was saved.
 */
export function Feedback({ vote, onVote }: { vote: Vote | null; onVote: (vote: Vote | null, reason?: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const down = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  async function choose(next: Vote | null) {
    setNote(null);
    setOpen(next === "down");
    if (next !== "down") setReason("");
    if (!(await onVote(next))) {
      setOpen(false);
      setNote("Couldn't save your feedback. Please try again.");
    }
  }

  function close() {
    setOpen(false);
    down.current?.focus();
  }

  async function sendReason() {
    const text = reason.trim();
    if (!text) return close();
    const saved = await onVote("down", text);
    setOpen(false);
    setNote(saved ? "Thanks, that helps." : "Couldn't save your feedback. Please try again.");
    down.current?.focus();
  }

  const button = (pressed: boolean) =>
    `inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-2 hover:text-text ${pressed ? "text-accent" : "text-muted"}`;

  // A fragment: the thumbs sit in the answer's action row, the reason box takes a row of its own.
  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-pressed={vote === "up"}
          aria-label="Helpful"
          title="Helpful"
          onClick={() => choose(vote === "up" ? null : "up")}
          className={button(vote === "up")}
        >
          <ThumbsUp size={14} aria-hidden="true" fill={vote === "up" ? "currentColor" : "none"} />
        </button>
        <button
          ref={down}
          type="button"
          aria-pressed={vote === "down"}
          aria-label="Not helpful"
          title="Not helpful"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => choose(vote === "down" ? null : "down")}
          className={button(vote === "down")}
        >
          <ThumbsDown size={14} aria-hidden="true" fill={vote === "down" ? "currentColor" : "none"} />
        </button>
        {note && <span className="ml-1 text-xs text-muted">{note}</span>}
      </div>
      {open && (
        <form
          id={id}
          onSubmit={(e) => {
            e.preventDefault();
            void sendReason();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          className="w-full max-w-md basis-full rounded-xl border border-border bg-surface-1 p-3"
        >
          <label htmlFor={`${id}-reason`} className="text-sm text-text">
            What was wrong? <span className="text-muted">(optional)</span>
          </label>
          <textarea
            id={`${id}-reason`}
            ref={box}
            rows={2}
            maxLength={MAX_REASON_CHARS}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-2 w-full resize-none rounded-lg border border-border-strong bg-surface-1 px-2 py-1.5 text-sm text-text placeholder:text-faint focus:border-accent focus:outline-none"
            placeholder="For example: it cited the wrong lesson"
          />
          <div className="mt-2 flex items-center gap-2">
            <button type="submit" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-strong">
              Send
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-text"
            >
              Close
            </button>
          </div>
        </form>
      )}
    </>
  );
}
