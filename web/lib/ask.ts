// Client for POST /ask. The API streams Server-Sent Events: frames separated by a blank line,
// each with a `data: {json}` line. We read the body incrementally and hand each event to a
// callback, so the UI can render tokens as they arrive.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8010";

export interface Source {
  n: number;
  title: string;
  trail: string;
  path: string;
  lines: [number, number];
  citation: string;
}

export type AskEvent =
  | { type: "sources"; sources: Source[] }
  | { type: "token"; text: string }
  | { type: "done"; refused: boolean; model: string; top_similarity: number; notice?: string }
  | { type: "error"; message: string };

export type Provider = "ollama" | "anthropic";

export interface KnowledgeBase {
  name: string;
  title: string;
  notice: string;
}

export async function listKbs(): Promise<KnowledgeBase[]> {
  const res = await fetch(`${API_URL}/kbs`);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export async function ask(
  question: string,
  kb: string,
  provider: Provider,
  onEvent: (event: AskEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, kb, provider }),
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
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)) as AskEvent);
    }
  }
}
