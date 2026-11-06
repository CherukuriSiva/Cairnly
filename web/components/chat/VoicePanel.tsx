"use client";

import { Keyboard, Mic, MicOff, PhoneOff, RotateCcw, X } from "lucide-react";
import type { CSSProperties } from "react";
import { clockText, endLine, failureLine, inCall, phaseLabel } from "@/lib/voice/machine";
import type { VoiceState } from "@/lib/voice/types";
import { SITE_NAME } from "@/lib/site";

/** The orb: it follows the voice of whoever is speaking (static under reduced motion). */
function Orb({ state }: { state: VoiceState }) {
  const level = state.phase === "speaking" || state.phase === "greeting" ? state.botLevel : state.phase === "listening" ? state.userLevel : 0;
  const style = { "--level": Math.min(1, level * 4).toFixed(2) } as CSSProperties;
  return <div className="voice-orb shrink-0" data-phase={state.phase} style={style} aria-hidden="true" />;
}

/** What was said this turn. Not a live region: screen readers would read every word twice
 * (they hear the bot already); the state line above is the one that is announced. */
function Captions({ state }: { state: VoiceState }) {
  if (!state.userCaption && !state.botCaption) {
    const hint =
      state.phase !== "connecting"
        ? "Ask a question out loud. Captions show here."
        : state.wakingSeconds !== null
          ? "The voice model sleeps when nobody is calling. Waking it can take up to a minute."
          : "Allow the microphone if your browser asks.";
    return <p className="text-sm text-muted">{hint}</p>;
  }
  return (
    <dl className="space-y-2 text-sm">
      {state.userCaption && (
        <div>
          <dt className="eyebrow text-faint">You</dt>
          <dd className="mt-0.5 text-text">{state.userCaption}</dd>
        </div>
      )}
      {state.botCaption && (
        <div>
          <dt className="eyebrow text-faint">{SITE_NAME}</dt>
          <dd className="mt-0.5 text-text">{state.botCaption}</dd>
        </div>
      )}
    </dl>
  );
}

const button =
  "inline-flex h-10 items-center gap-1.5 rounded-xl border border-border-strong bg-surface-1 px-3 text-sm text-text hover:border-accent disabled:opacity-50";

/** Voice mode, in place of the composer while a call runs: the orb, the state, the time left,
 * live captions, and Mute, End call and Type instead. After a call it says how the call ended
 * (or why it could not start) until dismissed. */
export function VoicePanel({
  state,
  onMute,
  onEnd,
  onTypeInstead,
  onRetry,
  onDismiss,
}: {
  state: VoiceState;
  onMute: () => void;
  onEnd: () => void;
  onTypeInstead: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (!inCall(state)) {
    const failed = state.phase === "failed";
    const line = failed ? failureLine(state.failure) : endLine(state.endReason);
    const canRetry = failed && state.failure === "transport" && state.available === true;
    return (
      <div role="status" className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm">
        <p className="min-w-0 flex-1 text-text">{line}</p>
        {canRetry && (
          <button type="button" onClick={onRetry} className={button}>
            <RotateCcw size={14} aria-hidden="true" />
            Try again
          </button>
        )}
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-text">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }

  const label = phaseLabel(state);
  const timeLeft = state.secondsLeft !== null ? clockText(state.secondsLeft) : null;
  return (
    <section aria-label="Voice call" className="rounded-2xl border border-border-strong bg-surface-1 p-4">
      <div className="flex items-center gap-4">
        <Orb state={state} />
        <div className="min-w-0 flex-1">
          <p role="status" className="font-medium text-text">
            {label}
            {state.endingSoon && <span className="sr-only">. The call ends in less than 30 seconds.</span>}
          </p>
          {/* Not in the status line above: a screen reader would read every second. */}
          {state.wakingSeconds !== null && <p className="mt-0.5 font-mono text-xs text-muted">{state.wakingSeconds} s</p>}
          {timeLeft && (
            <p className={`mt-0.5 font-mono text-xs ${state.endingSoon ? "text-warning" : "text-muted"}`}>
              {timeLeft} left{state.endingSoon ? " · ending soon" : ""}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 max-h-40 overflow-y-auto rounded-xl bg-surface-2 px-3 py-2.5" tabIndex={0} aria-label="Live captions">
        <Captions state={state} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onMute} aria-pressed={state.muted} disabled={state.phase === "connecting"} className={button}>
          {state.muted ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
          {state.muted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          onClick={onEnd}
          disabled={state.closing}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-strong disabled:opacity-50"
        >
          <PhoneOff size={15} aria-hidden="true" />
          {state.closing ? "Ending…" : "End call"}
        </button>
        <button type="button" onClick={onTypeInstead} disabled={state.closing} className={`${button} ml-auto border-transparent bg-transparent text-muted hover:text-text`}>
          <Keyboard size={15} aria-hidden="true" />
          Type instead
        </button>
      </div>
    </section>
  );
}
