// The chat as data: rows the transcript shows and the status of the turn in flight. Nothing
// here knows about React or the DOM, so the same rows can be driven by the text chat, the
// replay transport in tests, and later a voice call (rows carry the channel they came from).

import type { Channel, Source } from "@/lib/ask";

export type { Channel };
export type Vote = "up" | "down";

/** Why a turn failed. The recovery table (recovery.ts) maps each to what happens next. */
export type FailureKind =
  | "waking" // 503: the API or the model is still starting
  | "rate" // 429 with Retry-After
  | "network" // the request never reached the API
  | "stall" // the stream went quiet for too long mid-answer
  | "timeout" // no response headers in time
  | "forbidden" // 403: a turned-off provider
  | "gone" // 404: the saved conversation no longer exists (pruned or deleted)
  | "http" // any other HTTP error
  | "answer" // the server reported an error inside the stream
  | "ended" // the stream closed without a done or error event, or with no answer text
  | "stopped"; // the reader pressed Stop

/** The reader's question. `attempt` counts tries (1, then each retry). */
export interface UserRow {
  kind: "user";
  key: string;
  text: string;
  channel: Channel;
  scope: string | null; // the track it was asked in, so a retry asks the same way
  attempt: number;
  messageId?: number;
}

/** The answer. `live` while tokens stream in; `cut` when the stream failed part-way, so the
 * text is incomplete (shown, but never voted on or sent back as history). */
export interface AssistantRow {
  kind: "assistant";
  key: string;
  replyTo: string; // the key of the question it answers
  text: string;
  live: boolean;
  cut?: boolean;
  channel: Channel;
  sources: Source[];
  messageId?: number; // the saved answer (saved conversations only): vote buttons need it
  refused?: boolean;
  guard?: string;
  uncited?: boolean;
  notice?: string;
  model?: string;
  topSimilarity?: number;
  searched?: string; // the rewritten query, when it differs from the question
  vote?: Vote | null;
  restored?: boolean; // loaded from the server: shown at once, never animated
}

/** A failed try, with the card's retry state. */
export interface ErrorRow {
  kind: "error";
  key: string;
  replyTo: string;
  failure: FailureKind;
  message: string;
  attempt: number;
  retrying: boolean; // an automatic recovery is scheduled
}

export type Row = UserRow | AssistantRow | ErrorRow;

/** idle: nothing in flight; thinking: sent, no answer text yet; streaming: text arriving. */
export type TurnStatus = "idle" | "thinking" | "streaming";

/** Text for the one polite status region; `id` changes on every new announcement. */
export interface Announcement {
  id: number;
  text: string;
}

export interface ChatState {
  rows: Row[];
  status: TurnStatus;
  pending: string | null; // the key of the question in flight
  waking: boolean; // no answer after a few seconds: the model is probably starting
  announcement: Announcement | null;
}
