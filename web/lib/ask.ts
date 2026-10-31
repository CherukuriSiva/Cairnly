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
  | {
      type: "done";
      refused: boolean;
      model: string;
      top_similarity: number;
      query: string; // what was searched (the rewritten question for a follow-up)
      notice?: string;
    }
  | { type: "error"; message: string };

export type Provider = "ollama" | "anthropic";

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
  provider: Provider;
}

/** The request body: the last completed turns (errors and unfinished turns skipped), answers
 * cut to the API's limit, and the optional track scope. */
export function buildAskBody(
  question: string,
  turns: PastTurn[],
  track: string | null,
  provider: Provider,
): AskBody {
  const history = turns
    .filter((t) => t.status === "done" || t.status === "refused")
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ question: t.question, answer: t.answer.slice(0, MAX_ANSWER_CHARS) }));
  return { question, history, track, provider };
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
  if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

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
