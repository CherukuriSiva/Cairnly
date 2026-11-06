// What happens after a failed try: one table from failure kind to action. Automatic recoveries
// (wait and resend, resend once) are used at most once per question each; after that, and for
// every other failure, the chat shows the error with a Retry button.

import type { FailureKind } from "@/lib/chat/types";

export interface Failure {
  kind: FailureKind;
  message: string;
  status?: number;
  retryAfterS?: number; // from a Retry-After header
}

export type Recovery =
  | { type: "resend"; delayMs: number; fresh?: boolean } // fresh: in a new saved conversation
  | { type: "show"; action: "retry" };

export const WAKE_RETRY_MS = 3_000; // a cold start: wait, then ask again
export const MAX_WAKE_WAIT_MS = 15_000;
export const MAX_RATE_WAIT_S = 10; // a longer rate-limit wait is shown, not waited out
export const NETWORK_RETRY_MS = 3_000;
export const STALL_RETRY_MS = 500;

const SHOW: Recovery = { type: "show", action: "retry" };

/** The kind of failure an HTTP status means. */
export function failureForStatus(status: number): FailureKind {
  if (status === 503) return "waking";
  if (status === 429) return "rate";
  if (status === 403) return "forbidden";
  if (status === 404) return "gone";
  return "http";
}

const TABLE: Record<FailureKind, (f: Failure) => Recovery> = {
  // 503: the model or the API is starting. Wait (Retry-After, at least 3 s, at most 15 s) and ask again.
  waking: (f) => ({ type: "resend", delayMs: Math.min(MAX_WAKE_WAIT_MS, Math.max(WAKE_RETRY_MS, (f.retryAfterS ?? 0) * 1000)) }),
  // 429: a short wait is waited out once; a long one (the daily cap) is only shown.
  rate: (f) =>
    f.retryAfterS !== undefined && f.retryAfterS > 0 && f.retryAfterS <= MAX_RATE_WAIT_S ? { type: "resend", delayMs: f.retryAfterS * 1000 } : SHOW,
  network: () => ({ type: "resend", delayMs: NETWORK_RETRY_MS }),
  stall: () => ({ type: "resend", delayMs: STALL_RETRY_MS }),
  // 404 on /ask: the saved conversation is gone (pruned after 30 idle days); start a new one.
  gone: () => ({ type: "resend", delayMs: 0, fresh: true }),
  timeout: () => SHOW,
  forbidden: () => SHOW,
  http: () => SHOW,
  answer: () => SHOW,
  ended: () => SHOW,
  stopped: () => SHOW,
};

/** The action for `failure`, given the automatic recoveries this question has already used. */
export function recoveryFor(failure: Failure, used: ReadonlySet<FailureKind>): Recovery {
  const action = TABLE[failure.kind](failure);
  return action.type === "resend" && used.has(failure.kind) ? SHOW : action;
}
