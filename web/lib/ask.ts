// Client for POST /ask. The API streams Server-Sent Events: frames separated by a blank line,
// each with a `data: {json}` line. We read the body incrementally and hand each event to a
// callback, so the UI can render tokens as they arrive.

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
}

export interface AskBody {
  question: string;
  history: { question: string; answer: string }[];
  track: string | null;
  session_id: string;
  provider?: Provider; // only when the reader chose one; otherwise the server default applies
}

/** The request body: the last completed turns (errors and unfinished turns skipped), answers
 * cut to the API's limit, the optional track scope, the tab's session id, and the provider
 * only when the reader picked one. */
export function buildAskBody(
  question: string,
  turns: PastTurn[],
  track: string | null,
  sessionId: string,
  provider: Provider | null = null,
): AskBody {
  const history = turns
    .filter((t) => t.status === "done" || t.status === "refused")
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

export async function ask(
  body: AskBody,
  onEvent: (event: AskEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = [403, 429, 503].includes(res.status) ? await readDetail(res) : null;
    throw new Error(errorMessage(res.status, detail, res.headers.get("Retry-After")));
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
