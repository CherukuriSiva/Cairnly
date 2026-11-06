"use client";

import { ArrowUp, Mic, Square, X } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";

const MAX_LINES = 6;

/** The input pinned under the chat: an auto-growing textarea (up to 6 lines), the scope chip,
 * and Ask or Stop. Enter sends, Shift+Enter adds a line, and Enter while an IME is composing
 * does not send. With voice mode: a microphone button (`onVoice`, only when the voice server
 * says calls are possible), the voice panel in place of the input during a call (`voicePanel`)
 * and a notice above it after a call (`voiceNotice`). */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
  placeholder,
  scopeTitle,
  onClearScope,
  onVoice,
  voicePanel,
  voiceNotice,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
  placeholder: string;
  scopeTitle: string | null;
  onClearScope: () => void;
  onVoice?: () => void;
  voicePanel?: ReactNode;
  voiceNotice?: ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to MAX_LINES; beyond that the textarea scrolls.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const line = parseFloat(getComputedStyle(box).lineHeight) || 24;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, line * MAX_LINES + 16)}px`;
  }, [value]);

  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 bg-[color-mix(in_srgb,var(--bg)_80%,transparent)] px-4 pb-4 pt-3 backdrop-blur-md">
      {voiceNotice}
      {voicePanel ?? (
        <>
          {scopeTitle && (
            <p className="mb-2">
              <button
                type="button"
                onClick={onClearScope}
                aria-label={`Remove scope ${scopeTitle}`}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-1 px-3 py-1 text-xs text-accent hover:border-accent"
              >
                Scoped to {scopeTitle}
                <X size={12} aria-hidden="true" />
              </button>
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
            className="flex items-end gap-2 rounded-2xl border border-border-strong bg-surface-1 p-2 focus-within:border-accent"
          >
            <label htmlFor="chat-input" className="sr-only">
              Your question
            </label>
            <textarea
              id="chat-input"
              ref={ref}
              rows={1}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                if (!busy) onSubmit();
              }}
              placeholder={placeholder}
              className="max-h-60 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[0.9375rem] leading-6 text-text outline-none placeholder:text-faint focus-visible:outline-none"
            />
            {onVoice && !busy && (
              <button
                type="button"
                onClick={onVoice}
                aria-label="Talk to Cairnly"
                title="Talk to Cairnly"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border-strong text-muted hover:border-accent hover:text-text"
              >
                <Mic size={16} aria-hidden="true" />
              </button>
            )}
            {busy ? (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-border-strong px-3 text-sm text-text hover:bg-surface-2"
              >
                <Square size={13} aria-hidden="true" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-strong"
              >
                Ask
                <ArrowUp size={15} aria-hidden="true" />
              </button>
            )}
          </form>
        </>
      )}
    </div>
  );
}
