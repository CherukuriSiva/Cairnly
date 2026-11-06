// Saved conversations on the API (newer APIs only; GET /config lists them under `features`):
// a small client for the routes, the browser's pointer to its conversation, and the mapping
// from saved messages to rows. The id is a random UUIDv4 made by the server; it is the only key
// to the conversation, so it stays in this browser and is never put in a URL.

import { API_URL, type Channel, type Source } from "@/lib/ask";
import type { AssistantRow, Row, UserRow, Vote } from "@/lib/chat/types";

export const CONVERSATION_KEY = "cairnly.conversation.v1";
export const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A message as GET /conversations/{id} returns it (answers carry the extra fields). */
export interface SavedMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  channel: Channel;
  created_at: string;
  sources?: Source[];
  vote?: Vote | null;
  refused?: boolean | null;
  guard?: string | null;
  uncited?: boolean | null;
  notice?: string | null;
}

export class ConversationError extends Error {
  constructor(readonly status: number) {
    super(`conversation request failed (${status})`);
    this.name = "ConversationError";
  }
}

export interface ConversationApi {
  create(): Promise<string>;
  /** The messages oldest first, or null when the conversation does not exist (any more). */
  load(id: string): Promise<SavedMessage[] | null>;
  remove(id: string): Promise<void>;
  vote(id: string, messageId: number, vote: Vote | null, reason?: string): Promise<void>;
}

/** The routes on the API. Every failure rejects (a ConversationError for HTTP errors). */
export function httpConversationApi(apiUrl: string = API_URL): ConversationApi {
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${apiUrl}${path}`, { cache: "no-store", ...init });
    if (!res.ok) throw new ConversationError(res.status);
    return res;
  };
  return {
    async create() {
      const body = (await (await call("/conversations", { method: "POST" })).json()) as { id?: unknown };
      if (typeof body.id !== "string" || !CONVERSATION_ID.test(body.id)) throw new ConversationError(500);
      return body.id;
    },
    async load(id) {
      try {
        const body = (await (await call(`/conversations/${id}`)).json()) as { messages?: unknown };
        return Array.isArray(body.messages) ? (body.messages as SavedMessage[]) : [];
      } catch (err) {
        if (err instanceof ConversationError && err.status === 404) return null;
        throw err;
      }
    },
    async remove(id) {
      try {
        await call(`/conversations/${id}`, { method: "DELETE" });
      } catch (err) {
        if (!(err instanceof ConversationError && err.status === 404)) throw err;
      }
    },
    async vote(id, messageId, vote, reason) {
      await call(`/conversations/${id}/messages/${messageId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason ? { vote, reason } : { vote }),
      });
    },
  };
}

/** Where the browser keeps its conversation id. Storage may be blocked (private mode, a
 * sandbox), so every call is guarded and failures behave like "no saved conversation". */
export interface ConversationStorage {
  read(): string | null;
  write(id: string): void;
  clear(): void;
}

export const browserStorage: ConversationStorage = {
  read() {
    try {
      const id = window.localStorage.getItem(CONVERSATION_KEY);
      return id && CONVERSATION_ID.test(id) ? id : null;
    } catch {
      return null;
    }
  },
  write(id) {
    try {
      window.localStorage.setItem(CONVERSATION_KEY, id);
    } catch {
      // storage blocked: the conversation lasts as long as the page
    }
  },
  clear() {
    try {
      window.localStorage.removeItem(CONVERSATION_KEY);
    } catch {
      // nothing stored
    }
  },
};

/** Storage that lives only as long as the object (tests, and pages where storage is unwanted). */
export function memoryStorage(initial: string | null = null): ConversationStorage {
  let id = initial;
  return { read: () => id, write: (v) => void (id = v), clear: () => void (id = null) };
}

/** Saved messages as rows: shown as they are, never animated. An answer without its question
 * (should not happen; both are saved together) is kept under the previous question. */
export function rowsFromMessages(messages: SavedMessage[]): Row[] {
  const rows: Row[] = [];
  let question: UserRow | null = null;
  for (const m of messages) {
    if (m.role === "user") {
      question = { kind: "user", key: `m${m.id}`, text: m.text, channel: m.channel, scope: null, attempt: 1, messageId: m.id };
      rows.push(question);
    } else if (question) {
      const answer: AssistantRow = {
        kind: "assistant",
        key: `m${m.id}`,
        replyTo: question.key,
        text: m.text,
        live: false,
        channel: m.channel,
        sources: (m.sources ?? []).map((s) => ({ ...s, url: s.url ?? "" })),
        messageId: m.id,
        refused: m.refused || undefined,
        guard: m.guard || undefined,
        uncited: m.uncited || undefined,
        notice: m.notice || undefined,
        vote: m.vote ?? null,
        restored: true,
      };
      rows.push(answer);
    }
  }
  return rows;
}
