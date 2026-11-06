// Server-Sent Events from POST /ask: frames separated by a blank line, each with one
// `data: {json}` line. `splitFrames` cuts buffered text into frames; `parseEvent` checks one
// frame's data against the event shapes in lib/ask.ts. An unknown event type is skipped, never
// fatal, so the API can add events without breaking older pages; a malformed one is skipped too.

import type { AskEvent, Source } from "@/lib/ask";

export type ParsedEvent =
  | { kind: "ok"; event: AskEvent }
  | { kind: "unknown"; type: string }
  | { kind: "invalid"; reason: string };

/** Split buffered SSE text into the data of each complete frame plus the unfinished rest.
 * Frames without a data line (comments such as ": keep-alive") are dropped. */
export function splitFrames(buffer: string): { data: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const frames = normalized.split("\n\n");
  const rest = frames.pop() ?? "";
  const data: string[] = [];
  for (const frame of frames) {
    const line = frame.split("\n").find((l) => l.startsWith("data:"));
    if (line) data.push(line.slice(5).replace(/^ /, ""));
  }
  return { data, rest };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || v === null || check(v);

function isSource(v: unknown): v is Source {
  return (
    isObject(v) &&
    typeof v.n === "number" &&
    isString(v.title) &&
    isString(v.trail) &&
    isString(v.path) &&
    isString(v.citation) &&
    optional(v.url, isString)
  );
}

/** One frame's data: valid, of an unknown type, or malformed (bad JSON or a wrong field). */
export function parseEvent(data: string): ParsedEvent {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return { kind: "invalid", reason: "not JSON" };
  }
  if (!isObject(value) || !isString(value.type)) return { kind: "invalid", reason: "no type" };
  const v = value;
  const type = value.type;
  switch (type) {
    case "sources":
      if (!Array.isArray(v.sources) || !v.sources.every(isSource)) return { kind: "invalid", reason: "sources" };
      return { kind: "ok", event: { type: "sources", sources: v.sources.map((s) => ({ ...s, url: s.url ?? "" })) } };
    case "token":
      return isString(v.text) ? { kind: "ok", event: { type: "token", text: v.text } } : { kind: "invalid", reason: "token" };
    case "retract":
      return isString(v.message) ? { kind: "ok", event: { type: "retract", message: v.message } } : { kind: "invalid", reason: "retract" };
    case "error":
      return isString(v.message) ? { kind: "ok", event: { type: "error", message: v.message } } : { kind: "invalid", reason: "error" };
    case "done":
      if (
        typeof v.refused !== "boolean" ||
        !optional(v.text, isString) ||
        !optional(v.message_id, (id) => Number.isSafeInteger(id) && (id as number) > 0) ||
        !optional(v.guard, isString) ||
        !optional(v.notice, isString)
      ) {
        return { kind: "invalid", reason: "done" };
      }
      return {
        kind: "ok",
        event: {
          type: "done",
          refused: v.refused as boolean,
          model: isString(v.model) ? v.model : "",
          top_similarity: typeof v.top_similarity === "number" ? v.top_similarity : 0,
          query: isString(v.query) ? v.query : "",
          notice: isString(v.notice) ? v.notice : undefined,
          guard: isString(v.guard) ? v.guard : null,
          uncited: v.uncited === true,
          text: isString(v.text) ? v.text : undefined,
          message_id: typeof v.message_id === "number" ? v.message_id : undefined,
        },
      };
    default:
      return { kind: "unknown", type };
  }
}
