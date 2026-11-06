// The chat as a pure reducer: actions (a question sent, a server event, a failure, a retry, a
// restore from the server) in, rows and the turn status out. Only one question is in flight at
// a time (`pending`); events for no pending question are ignored.
//
// Rules worth knowing:
// - The `done` event's text, when the API sends it, is the source of truth: it replaces the
//   streamed text (a dropped token can never stay wrong) and attaches the saved message id.
// - An answer bubble that closes with no text is dropped; an error card takes its place.
// - A failure keeps any partial text as a `cut` answer above the error card; a retry removes
//   both and asks again in place, even for an older question.
// - Each finished answer is announced once, as plain text, through `announcement`.

import { TIMEOUT_MESSAGE, type AskEvent } from "@/lib/ask";
import { plainText } from "@/lib/chat/plain";
import { SITE_NAME } from "@/lib/site";
import type { AssistantRow, Channel, ChatState, ErrorRow, FailureKind, Row, UserRow, Vote } from "@/lib/chat/types";

export const ENDED_EARLY = "The answer ended early. Please try again.";
export const NO_ANSWER = "No answer came back. Please try again.";
export const STOPPED = "Stopped.";
export const WAKING_NOTE = "Waking up the model, the first answer can take up to a minute.";

export type ChatAction =
  | { type: "send"; key: string; text: string; scope: string | null; channel?: Channel }
  | { type: "resend"; replyTo: string }
  | { type: "event"; event: AskEvent }
  | { type: "waking" }
  | { type: "failed"; failure: FailureKind; message: string; retrying?: boolean }
  | { type: "retry-cancelled" }
  | { type: "restore"; rows: Row[] }
  | { type: "reset" }
  | { type: "vote"; messageId: number; vote: Vote | null };

/** The card's title (and an optional second line) for a failed try; the status region
 * announces the same title. */
export function failureTitle(row: Pick<ErrorRow, "failure" | "attempt" | "message">): { title: string; text?: string } {
  if (row.failure === "waking" || row.failure === "network") {
    if (row.attempt > 1) return { title: `${SITE_NAME} still isn't answering. Please try again in a minute.` };
    return { title: `${SITE_NAME} is waking up`, text: "This can take a few seconds." };
  }
  if (row.failure === "timeout") return { title: TIMEOUT_MESSAGE };
  return { title: row.message || "Something went wrong." };
}

export const initialChatState: ChatState = { rows: [], status: "idle", pending: null, waking: false, announcement: null };

const isUser = (r: Row, key: string): r is UserRow => r.kind === "user" && r.key === key;
const liveReply = (r: Row, key: string): r is AssistantRow => r.kind === "assistant" && r.replyTo === key && r.live;

/** Insert `row` after the last row that belongs to the question `replyTo`. */
function insertInTurn(rows: Row[], replyTo: string, row: Row): Row[] {
  const start = rows.findIndex((r) => isUser(r, replyTo));
  if (start < 0) return [...rows, row];
  let end = start + 1;
  while (end < rows.length && rows[end].kind !== "user") end++;
  return [...rows.slice(0, end), row, ...rows.slice(end)];
}

function announce(state: ChatState, text: string): ChatState["announcement"] {
  return { id: (state.announcement?.id ?? 0) + 1, text };
}

/** Apply `fn` to the live answer of the pending question, creating it first if needed. */
function withLiveAnswer(state: ChatState, fn: (row: AssistantRow) => AssistantRow): Row[] {
  const key = state.pending as string;
  const existing = state.rows.find((r) => liveReply(r, key));
  if (existing) return state.rows.map((r) => (r === existing ? fn(existing) : r));
  const user = state.rows.find((r) => isUser(r, key)) as UserRow | undefined;
  const fresh: AssistantRow = {
    kind: "assistant",
    key: `${key}:a${user?.attempt ?? 1}`,
    replyTo: key,
    text: "",
    live: true,
    channel: user?.channel ?? "text",
    sources: [],
  };
  return insertInTurn(state.rows, key, fn(fresh));
}

function onEvent(state: ChatState, event: AskEvent): ChatState {
  if (state.pending === null) return state;
  switch (event.type) {
    case "sources":
      return { ...state, rows: withLiveAnswer(state, (r) => ({ ...r, sources: event.sources })) };
    case "token":
      return {
        ...state,
        status: "streaming",
        waking: false,
        rows: withLiveAnswer(state, (r) => ({ ...r, text: r.text + event.text })),
      };
    case "retract":
      return { ...state, status: "streaming", waking: false, rows: withLiveAnswer(state, (r) => ({ ...r, text: event.message, refused: true })) };
    case "error":
      return fail(state, "answer", event.message, false);
    case "done": {
      const rows = withLiveAnswer(state, (r) => ({
        ...r,
        text: event.text ?? r.text,
        live: false,
        messageId: event.message_id,
        refused: event.refused || r.refused || undefined,
        guard: event.guard || undefined,
        uncited: event.uncited || undefined,
        notice: event.notice || undefined,
        model: event.model || undefined,
        topSimilarity: event.top_similarity,
        vote: event.message_id ? null : undefined,
      }));
      const answer = rows.find((r) => r.kind === "assistant" && r.replyTo === state.pending && !r.live && !r.cut) as AssistantRow | undefined;
      const question = rows.find((r) => isUser(r, state.pending as string)) as UserRow | undefined;
      if (!answer || !answer.text.trim()) {
        // An empty answer is dropped; say so with a card the reader can retry from.
        return fail({ ...state, rows: rows.filter((r) => r !== answer) }, "ended", NO_ANSWER, false);
      }
      const searched = event.query && question && event.query !== question.text ? event.query : undefined;
      return {
        ...state,
        rows: rows.map((r) => (r === answer ? { ...answer, searched } : r)),
        status: "idle",
        pending: null,
        waking: false,
        announcement: announce(state, `${SITE_NAME} answered: ${plainText(answer.text)}`),
      };
    }
  }
}

/** End the pending try with a failure. Partial text stays as a cut answer; an empty bubble is
 * dropped. With `retrying`, an automatic recovery is scheduled and the turn stays busy. */
function fail(state: ChatState, failure: FailureKind, message: string, retrying: boolean): ChatState {
  const key = state.pending;
  if (key === null) return state;
  const user = state.rows.find((r) => isUser(r, key)) as UserRow | undefined;
  const attempt = user?.attempt ?? 1;
  let rows: Row[] = state.rows
    .filter((r) => !(liveReply(r, key) && !r.text.trim()))
    .map((r) => (liveReply(r, key) ? { ...r, live: false, cut: true } : r))
    .filter((r) => !(r.kind === "error" && r.replyTo === key));
  const error: ErrorRow = { kind: "error", key: `${key}:e${attempt}`, replyTo: key, failure, message, attempt, retrying };
  rows = insertInTurn(rows, key, error);
  return {
    ...state,
    rows,
    status: retrying ? "thinking" : "idle",
    pending: retrying ? key : null,
    waking: false,
    announcement: retrying ? state.announcement : announce(state, failureTitle(error).title),
  };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send": {
      if (state.pending !== null) return state;
      const user: UserRow = {
        kind: "user",
        key: action.key,
        text: action.text,
        channel: action.channel ?? "text",
        scope: action.scope,
        attempt: 1,
      };
      return { ...state, rows: [...state.rows, user], status: "thinking", pending: action.key, waking: false };
    }
    case "resend": {
      const key = action.replyTo;
      if (state.pending !== null && state.pending !== key) return state;
      if (!state.rows.some((r) => isUser(r, key))) return state;
      const rows = state.rows
        .filter((r) => !((r.kind === "error" || (r.kind === "assistant" && (r.cut || r.live))) && r.replyTo === key))
        .map((r) => (isUser(r, key) ? { ...r, attempt: r.attempt + 1 } : r));
      return { ...state, rows, status: "thinking", pending: key, waking: false };
    }
    case "event":
      return onEvent(state, action.event);
    case "waking":
      if (state.pending === null || state.waking) return state;
      return { ...state, waking: true, announcement: announce(state, WAKING_NOTE) };
    case "failed":
      return fail(state, action.failure, action.message, action.retrying ?? false);
    case "retry-cancelled": {
      const key = state.pending;
      if (key === null) return state;
      return {
        ...state,
        status: "idle",
        pending: null,
        rows: state.rows.map((r) => (r.kind === "error" && r.replyTo === key ? { ...r, retrying: false } : r)),
      };
    }
    case "restore":
      return { ...initialChatState, announcement: state.announcement, rows: action.rows };
    case "reset":
      return { ...initialChatState, announcement: state.announcement };
    case "vote":
      return {
        ...state,
        rows: state.rows.map((r) => (r.kind === "assistant" && r.messageId === action.messageId ? { ...r, vote: action.vote } : r)),
      };
  }
}

/** The finished turns before the question `before` (all of them when null), as /ask history
 * for an API that does not keep the conversation: cut answers, errors and guard refusals are
 * skipped, exactly as the server does for saved conversations. */
export function pastTurns(rows: Row[], before: string | null = null) {
  const turns: { question: string; answer: string; status: "done" | "refused"; guard?: string }[] = [];
  let question: UserRow | null = null;
  for (const row of rows) {
    if (row.kind === "user") {
      if (row.key === before) break;
      question = row;
    } else if (row.kind === "assistant" && question && !row.live && !row.cut) {
      turns.push({ question: question.text, answer: row.text, status: row.refused ? "refused" : "done", guard: row.guard });
      question = null;
    }
  }
  return turns;
}

/** Rows grouped per question, for rendering one block per turn. */
export function groupTurns(rows: Row[]): { question: UserRow; replies: (AssistantRow | ErrorRow)[] }[] {
  const groups: { question: UserRow; replies: (AssistantRow | ErrorRow)[] }[] = [];
  for (const row of rows) {
    if (row.kind === "user") groups.push({ question: row, replies: [] });
    else groups.at(-1)?.replies.push(row);
  }
  return groups;
}
