// How a question reaches an answer stream. A transport sends one /ask body and hands each SSE
// frame's data string to `onData` until the stream ends; it rejects with a TransportError (or
// the browser's AbortError after a Stop). Two implementations: `liveTransport` (the API, below)
// and `replayTransport` (recorded streams, replay.ts) for tests and the ?demo=1 chat.

import { API_URL, ASK_TIMEOUT_MS, errorMessage, headerTimeout, NETWORK_MESSAGE, readDetail, TIMEOUT_MESSAGE, type AskBody } from "@/lib/ask";
import { splitFrames } from "@/lib/chat/events";
import { failureForStatus } from "@/lib/chat/recovery";
import type { FailureKind } from "@/lib/chat/types";
import { SITE_NAME } from "@/lib/site";

export interface ChatTransport {
  readonly kind: "live" | "replay";
  send(body: AskBody, onData: (data: string) => void, signal: AbortSignal): Promise<void>;
}

export class TransportError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
    readonly status?: number,
    readonly retryAfterS?: number,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export const STALL_MS = 45_000; // once the answer streams, this long with no byte is a stall
// Before the first token the API is legitimately quiet while a cold GPU loads the model (the
// API allows 90 s for the first token, after a rewrite and an embedding); Modal ends a request
// after 150 s anyway, so a longer silence cannot be an answer still coming.
export const FIRST_TOKEN_STALL_MS = 150_000;
export const STALL_MESSAGE = `${SITE_NAME} stopped sending the answer.`;

function retryAfterSeconds(value: string | null): number | undefined {
  const seconds = Number(value);
  return value && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** True once a frame other than the sources arrived: the answer itself has started. */
function answerStarted(data: string): boolean {
  return !/^\s*\{\s*"type"\s*:\s*"sources"/.test(data);
}

/**
 * POST /ask on the API and stream its events. No response headers within `headerTimeoutMs` is
 * a timeout; after the headers, a stall timer restarts on every received byte and fails the
 * stream after `stallMs` of silence (`firstTokenStallMs` until the answer starts).
 */
export function liveTransport(
  apiUrl: string = API_URL,
  { headerTimeoutMs = ASK_TIMEOUT_MS, stallMs = STALL_MS, firstTokenStallMs = FIRST_TOKEN_STALL_MS } = {},
): ChatTransport {
  return {
    kind: "live",
    async send(body, onData, signal) {
      const timer = headerTimeout(signal, headerTimeoutMs);
      let res: Response;
      try {
        res = await fetch(`${apiUrl}/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: timer.signal,
        });
      } catch (err) {
        if (timer.timedOut()) throw new TransportError(TIMEOUT_MESSAGE, "timeout");
        if (signal.aborted) throw err;
        if (err instanceof TypeError) throw new TransportError(NETWORK_MESSAGE, "network");
        throw err;
      } finally {
        timer.clear();
      }
      if (!res.ok || !res.body) {
        const detail = [403, 404, 429, 503].includes(res.status) ? await readDetail(res) : null;
        const retryAfter = res.headers.get("Retry-After");
        throw new TransportError(errorMessage(res.status, detail, retryAfter), failureForStatus(res.status), res.status, retryAfterSeconds(retryAfter));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let started = false;
      let stalled = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const arm = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(
          () => {
            stalled = true;
            reader.cancel().catch(() => {});
          },
          started ? stallMs : firstTokenStallMs,
        );
      };
      try {
        arm();
        for (;;) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (err) {
            if (stalled) throw new TransportError(STALL_MESSAGE, "stall");
            if (signal.aborted) throw err;
            throw new TransportError(NETWORK_MESSAGE, "network");
          }
          if (stalled) throw new TransportError(STALL_MESSAGE, "stall");
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const { data, rest } = splitFrames(buffer);
          buffer = rest;
          for (const item of data) {
            started ||= answerStarted(item);
            onData(item);
          }
          arm(); // every byte restarts the stall timer
        }
      } finally {
        clearTimeout(watchdog);
      }
    },
  };
}
