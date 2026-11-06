// Shared shapes and helpers for the API: the /ask request and its events, GET /config, the
// warm-up call and the per-tab session id. The streaming itself lives in lib/chat/ (the
// transports, the event parser, the reducer and the controller that drives a turn).

import { SITE_NAME } from "@/lib/site";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8010";

export const MAX_HISTORY_TURNS = 6; // the API rejects more
export const MAX_ANSWER_CHARS = 4000; // the API's per-answer limit

export interface Source {
  n: number;
  title: string;
  trail: string;
  path: string;
  lines: [number, number];
  citation: string;
  url: string; // page link with the section anchor; "" when the source has no page
}

export type AskEvent =
  | { type: "sources"; sources: Source[] }
  | { type: "token"; text: string }
  | { type: "retract"; message: string } // a safety check withdrew the answer so far
  | {
      type: "done";
      refused: boolean;
      model: string;
      top_similarity: number;
      query: string; // what was searched (the rewritten question for a follow-up)
      notice?: string;
      kb?: string;
      prompt_version?: string;
      guard?: string | null; // the safety rule that refused the question, if any
      uncited?: boolean; // an answer with no [n] citation
      text?: string; // the whole answer as the reader should see it (newer APIs)
      message_id?: number; // the saved answer, when the turn belongs to a saved conversation
    }
  | { type: "error"; message: string };

export type Provider = "ollama" | "anthropic";

export const PROVIDER_LABELS: Record<Provider, string> = {
  ollama: "Open model (Ollama)",
  anthropic: "Claude API (local only)",
};

/** What the server allows (GET /config). `features` is missing on APIs older than saved
 * conversations; the chat then keeps the conversation in the tab, as it always did. */
export interface AppConfig {
  providers: Provider[];
  default_provider: Provider;
  features?: { conversations?: boolean; feedback?: boolean };
}

/** The optional API features the chat may use. */
export interface Features {
  conversations: boolean;
  feedback: boolean;
}

export const NO_FEATURES: Features = { conversations: false, feedback: false };

/** The features a /config answer turns on; anything missing or malformed counts as off. */
export function featuresOf(config: AppConfig | null): Features {
  const f = config?.features;
  if (!f || typeof f !== "object") return NO_FEATURES;
  const conversations = f.conversations === true;
  return { conversations, feedback: conversations && f.feedback === true };
}

/** A finished or failed earlier turn, as history for a follow-up. */
export interface PastTurn {
  question: string;
  answer: string;
  status: "streaming" | "done" | "refused" | "error";
  guard?: string; // the safety rule that refused it; such a turn is never sent back as history
}

export type Channel = "text" | "voice";

export interface AskBody {
  question: string;
  history: { question: string; answer: string }[];
  track: string | null;
  session_id: string;
  provider?: Provider; // only when the reader chose one; otherwise the server default applies
  conversation_id?: string; // a saved conversation: the server then uses its own history
  channel?: Channel; // only sent with a conversation id
}

/** The request body: the last completed turns (errors, unfinished turns and turns the safety
 * check refused skipped), answers cut to the API's limit, the optional track scope, the tab's
 * session id, and the provider only when the reader picked one.
 *
 * A refused attack must not travel on as history: the server checks every earlier question, so
 * it would block each of the next follow-ups too. */
export function buildAskBody(
  question: string,
  turns: PastTurn[],
  track: string | null,
  sessionId: string,
  provider: Provider | null = null,
): AskBody {
  const history = turns
    .filter((t) => (t.status === "done" || t.status === "refused") && !t.guard)
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ question: t.question, answer: t.answer.slice(0, MAX_ANSWER_CHARS) }));
  const body: AskBody = { question, history, track, session_id: sessionId };
  if (provider) body.provider = provider;
  return body;
}

/** The message to show for a refused request: friendly for limits and turned-off features,
 * the plain status otherwise. */
export function errorMessage(
  status: number,
  detail: string | null,
  retryAfter: string | null,
): string {
  if (status === 429) {
    const seconds = Number(retryAfter);
    const wait = retryAfter && Number.isFinite(seconds) && seconds > 0 ? `${seconds} seconds` : "a minute";
    return `You've asked a lot of questions. Please wait ${wait} and try again.`;
  }
  if ((status === 503 || status === 403) && detail) return detail;
  return `Request failed (${status})`;
}

/** The `detail` string of an error response, or null. */
export async function readDetail(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : null;
  } catch {
    return null;
  }
}

/** The providers this server allows, or null when the API cannot be reached. */
export async function fetchConfig(): Promise<AppConfig | null> {
  try {
    const res = await fetch(`${API_URL}/config`);
    return res.ok ? ((await res.json()) as AppConfig) : null;
  } catch {
    return null;
  }
}

let warmed = false;

/**
 * Wake the API ahead of the first question: a fire-and-forget GET /health when the home page or
 * the chat opens, at most once per page load. It starts the API container and its database
 * connection (not the GPU model, which wakes on the first question). Never throws, never waits;
 * `no-cors` keeps a refused origin from logging a console error.
 */
export function warmUp(): void {
  if (warmed) return;
  warmed = true;
  fetch(`${API_URL}/health`, { mode: "no-cors", cache: "no-store" }).catch(() => {});
}

const SESSION_KEY = "cairnly.session";
const SESSION_PATTERN = /^[A-Za-z0-9-]{8,64}$/; // what the API accepts
let memorySession: string | null = null;

function newSessionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID needs a secure context (https or localhost); random bytes work everywhere.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** A random id for this browser tab, so follow-ups group into one trace session. It is not a
 * user id: a new tab gets a new one. Falls back to memory when storage is blocked. */
export function getSessionId(): string {
  try {
    const saved = window.sessionStorage.getItem(SESSION_KEY);
    if (saved && SESSION_PATTERN.test(saved)) return saved;
    const id = newSessionId();
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    memorySession ??= newSessionId();
    return memorySession;
  }
}

export const ASK_TIMEOUT_MS = 30_000; // no response headers in this long: "didn't answer in time"
export const NETWORK_MESSAGE = `Could not reach ${SITE_NAME}.`;
export const TIMEOUT_MESSAGE = `${SITE_NAME} didn't answer in time.`;

/**
 * A signal that aborts when `outer` aborts or when `ms` pass first. Call `clear()` as soon as
 * the response headers arrive, so a live stream is never cut; `timedOut()` tells the two
 * abort causes apart.
 */
export function headerTimeout(
  outer: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; clear: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let expired = false;
  const onAbort = () => controller.abort(outer?.reason);
  if (outer?.aborted) controller.abort(outer.reason);
  else outer?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    expired = true;
    controller.abort(new DOMException("timed out", "TimeoutError"));
  }, ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer), timedOut: () => expired };
}
