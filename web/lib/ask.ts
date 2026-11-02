// Client for POST /ask. The API streams Server-Sent Events: frames separated by a blank line,
// each with a `data: {json}` line. We read the body incrementally and hand each event to a
// callback, so the UI can render tokens as they arrive.

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
      guard?: string | null; // the safety rule that refused the question, if any
      uncited?: boolean; // an answer with no [n] citation
    }
  | { type: "error"; message: string };

export type Provider = "ollama" | "anthropic";

export const PROVIDER_LABELS: Record<Provider, string> = {
  ollama: "Open model (Ollama)",
  anthropic: "Claude API (local only)",
};

/** What the server allows (GET /config). */
export interface AppConfig {
  providers: Provider[];
  default_provider: Provider;
}

/** A finished or failed earlier turn, as the chat keeps it. */
export interface PastTurn {
  question: string;
  answer: string;
  status: "streaming" | "done" | "refused" | "error";
  guard?: string; // the safety rule that refused it; such a turn is never sent back as history
}

/** A turn as the chat shows it while the answer streams in. */
export interface StreamedTurn extends PastTurn {
  meta?: string; // the error message of a failed turn
  waking?: boolean;
}

export const ENDED_EARLY = "The answer ended early. Please try again.";

/**
 * The turn once the answer stream has closed. Every normal answer ends with a done or error
 * event; a turn still "streaming" lost its stream (a proxy cut it, or the server stopped), so
 * it becomes an error instead of showing "Searching…" and a Stop button forever.
 */
export function closeTurn<T extends StreamedTurn>(turn: T): T {
  if (turn.status !== "streaming") return turn;
  return { ...turn, status: "error", meta: ENDED_EARLY, waking: false };
}

export interface AskBody {
  question: string;
  history: { question: string; answer: string }[];
  track: string | null;
  session_id: string;
  provider?: Provider; // only when the reader chose one; otherwise the server default applies
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

/** Split buffered SSE text into complete events plus the unfinished remainder. */
export function parseFrames(buffer: string): { events: AskEvent[]; rest: string } {
  const frames = buffer.split("\n\n");
  const rest = frames.pop() ?? "";
  const events: AskEvent[] = [];
  for (const frame of frames) {
    const line = frame.split("\n").find((l) => l.startsWith("data: "));
    if (line) events.push(JSON.parse(line.slice(6)) as AskEvent);
  }
  return { events, rest };
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

async function readDetail(res: Response): Promise<string | null> {
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

/** Why a request failed: the chat shows a different card for each. */
export type AskErrorKind = "waking" | "rate" | "forbidden" | "network" | "timeout" | "http";

/** A failed /ask request. `message` is the text the reader may see (errorMessage for HTTP
 * errors); `status` is set for HTTP errors only. */
export class AskError extends Error {
  constructor(
    message: string,
    readonly kind: AskErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AskError";
  }
}

/** 503 means the model is still starting (a cold start), 429 a rate limit, 403 a turned-off
 * feature; anything else is a plain HTTP error. */
export function errorKind(status: number): AskErrorKind {
  if (status === 503) return "waking";
  if (status === 429) return "rate";
  if (status === 403) return "forbidden";
  return "http";
}

export const ASK_TIMEOUT_MS = 30_000;
export const AUTO_RETRY_DELAY_MS = 3_000;
export const NETWORK_MESSAGE = `Could not reach ${SITE_NAME}.`;
export const TIMEOUT_MESSAGE = `${SITE_NAME} didn't answer in time.`;

/** One automatic retry, only for a cold start or a network failure, and only after the first
 * attempt (`attempt` counts the attempts made so far, starting at 1). */
export function shouldAutoRetry(kind: AskErrorKind, attempt: number): boolean {
  return attempt === 1 && (kind === "waking" || kind === "network");
}

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

/**
 * POST /ask and hand each streamed event to `onEvent`. Throws an AskError for an HTTP error,
 * a network failure or no response within `timeoutMs`; a Stop (the caller's `signal`)
 * surfaces as the browser's AbortError.
 */
export async function ask(
  body: AskBody,
  onEvent: (event: AskEvent) => void,
  signal?: AbortSignal,
  timeoutMs: number = ASK_TIMEOUT_MS,
): Promise<void> {
  const timer = headerTimeout(signal, timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: timer.signal,
    });
  } catch (err) {
    if (timer.timedOut()) throw new AskError(TIMEOUT_MESSAGE, "timeout");
    if (signal?.aborted) throw err;
    if (err instanceof TypeError) throw new AskError(NETWORK_MESSAGE, "network");
    throw err;
  } finally {
    timer.clear();
  }
  if (!res.ok || !res.body) {
    const detail = [403, 429, 503].includes(res.status) ? await readDetail(res) : null;
    throw new AskError(errorMessage(res.status, detail, res.headers.get("Retry-After")), errorKind(res.status), res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseFrames(buffer);
    buffer = rest;
    events.forEach(onEvent);
  }
}
