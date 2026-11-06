// Drives the chat: sends a question through a transport, feeds each parsed event to the
// reducer, applies the recovery table when a try fails, and keeps the saved conversation (when
// the API has the feature) in step. No React: the page subscribes to it (useSyncExternalStore),
// and tests run it with the replay transport and fake timers.
//
// Two modes, picked from GET /config:
// - saved conversations: the first question creates a conversation, its id is kept in this
//   browser, every question names it, and the server keeps the history. On load, the chat
//   restores it from the server.
// - history in the tab (an older API, a failed /config, ?demo=1): the chat sends the earlier
//   turns itself, exactly as before.

import { buildAskBody, type AskBody, type Features, type Provider } from "@/lib/ask";
import type { ConversationApi, ConversationStorage } from "@/lib/chat/conversations";
import { memoryStorage, rowsFromMessages } from "@/lib/chat/conversations";
import { parseEvent } from "@/lib/chat/events";
import { chatReducer, ENDED_EARLY, initialChatState, pastTurns, STOPPED, type ChatAction } from "@/lib/chat/reducer";
import { recoveryFor, type Failure } from "@/lib/chat/recovery";
import { TransportError, type ChatTransport } from "@/lib/chat/transport";
import type { Channel, ChatState, FailureKind, UserRow, Vote } from "@/lib/chat/types";

export const WAKING_AFTER_MS = 5_000; // no answer text yet: say the model is probably waking
export const CONFIG_WAIT_MS = 4_000; // a question waits this long at most for GET /config

/** What GET /config decided, or the demo. */
export interface ChatSetup {
  features: Features;
  conversations: ConversationApi | null; // used only when features.conversations
  transport?: ChatTransport; // replaces the default (the demo's replay transport)
}

export interface ChatControllerOptions {
  transport: ChatTransport;
  sessionId: () => string;
  provider?: () => Provider | null;
  storage?: ConversationStorage;
  wakingAfterMs?: number;
  configWaitMs?: number;
  /** Called for frames the parser skipped (unknown or malformed); debug logging only. */
  onSkipped?: (data: string, why: string) => void;
}

export class ChatController {
  private state: ChatState = initialChatState;
  private listeners = new Set<() => void>();
  private transport: ChatTransport;
  private features: Features = { conversations: false, feedback: false };
  private api: ConversationApi | null = null;
  private storage: ConversationStorage;
  private conversationId: string | null = null;
  private creating: Promise<string | null> | null = null;
  private storeBroken = false; // creating a conversation failed: history in the tab from now on
  private historyMode = false; // a question went out without a conversation: stay that way
  private configured = false;
  private ready: Promise<void>;
  private markReady!: () => void;
  private nextKey = 1;
  private abort: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private used = new Map<string, Set<FailureKind>>(); // automatic recoveries used per question
  private restoreToken = 0;
  private disposed = false;

  constructor(private readonly options: ChatControllerOptions) {
    this.transport = options.transport;
    this.storage = options.storage ?? memoryStorage();
    this.ready = new Promise((resolve) => (this.markReady = resolve));
  }

  getState = (): ChatState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The features in use (vote buttons need `feedback`). */
  getFeatures(): Features {
    return this.features;
  }

  /** The saved conversation, if there is one yet. */
  getConversationId(): string | null {
    return this.conversationId;
  }

  get busy(): boolean {
    return this.state.status !== "idle";
  }

  private dispatch(action: ChatAction): void {
    const next = chatReducer(this.state, action);
    if (next === this.state) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  /** Apply GET /config's answer (null: it failed). Questions sent before this wait for it,
   * briefly, so the first question already uses the right mode. Once only. */
  configure(setup: ChatSetup | null): void {
    if (this.configured) return;
    this.configured = true;
    if (setup) {
      if (setup.transport) this.transport = setup.transport;
      // Turning saved conversations on after a question went out with its history in the tab
      // would lose the turns asked so far.
      if (setup.features.conversations && setup.conversations && !this.historyMode) {
        this.features = setup.features;
        this.api = setup.conversations;
        this.conversationId = this.storage.read();
      }
    }
    this.markReady();
  }

  /** Show the saved conversation again (on page load). Skipped when a question was asked
   * meanwhile; a conversation the server no longer has is forgotten. */
  async restore(): Promise<void> {
    await this.ready;
    const id = this.conversationId;
    if (!this.api || !id || this.state.rows.length > 0) return;
    const token = ++this.restoreToken;
    try {
      const messages = await this.api.load(id);
      if (token !== this.restoreToken || this.disposed || this.state.rows.length > 0) return;
      if (messages === null) {
        this.forget();
        return;
      }
      this.dispatch({ type: "restore", rows: rowsFromMessages(messages) });
    } catch {
      // the API is unreachable: keep the id and try again on the next page load
    }
  }

  /** The saved conversation, created on first use; null in tab-history mode. */
  async ensureConversation(): Promise<string | null> {
    if (this.conversationId) return this.conversationId;
    if (!this.api || this.storeBroken) return null;
    this.creating ??= this.api
      .create()
      .then((id) => {
        this.conversationId = id;
        this.storage.write(id);
        return id;
      })
      .catch(() => {
        this.storeBroken = true;
        return null;
      })
      .finally(() => (this.creating = null));
    return this.creating;
  }

  /** Ask `text`. With `newConversation`, the question starts a new saved conversation (a
   * shared /ask?q= link) instead of following up the stored one. */
  send(text: string, scope: string | null, { newConversation = false, channel = "text" as Channel } = {}): void {
    if (!text.trim() || this.busy) return;
    if (newConversation) {
      this.restoreToken++; // a restore still in flight must not replace this question
      this.forget();
    }
    const key = `t${this.nextKey++}`;
    this.dispatch({ type: "send", key, text, scope, channel });
    void this.attempt(key);
  }

  /** The reader's Retry on a failed question: ask again in its place. */
  retry(key: string): void {
    this.cancelRetry();
    if (this.state.pending !== null && this.state.pending !== key) return;
    this.dispatch({ type: "resend", replyTo: key });
    void this.attempt(key);
  }

  /** Stop the answer in flight, or a scheduled automatic retry. */
  stop(): void {
    if (this.retryTimer) {
      this.cancelRetry();
      this.dispatch({ type: "retry-cancelled" });
    }
    this.abort?.abort();
  }

  /** Start over: clear the transcript and delete the saved conversation on the server. */
  newChat(): void {
    this.cancelRetry();
    this.abort?.abort();
    this.abort = null;
    this.restoreToken++;
    const id = this.conversationId;
    if (id && this.api) this.api.remove(id).catch(() => {}); // retention removes it otherwise
    this.forget();
    this.used.clear();
    this.dispatch({ type: "reset" });
  }

  /** Set or clear the reader's vote on a saved answer, at once; undone when the API refuses.
   * Resolves to whether it was saved. */
  async vote(messageId: number, vote: Vote | null, reason?: string): Promise<boolean> {
    const row = this.state.rows.find((r) => r.kind === "assistant" && r.messageId === messageId);
    const id = this.conversationId;
    if (!row || row.kind !== "assistant" || !this.api || !id) return false;
    const before = row.vote ?? null;
    this.dispatch({ type: "vote", messageId, vote });
    try {
      await this.api.vote(id, messageId, vote, reason);
      return true;
    } catch {
      const now = this.state.rows.find((r) => r.kind === "assistant" && r.messageId === messageId);
      if (now?.kind === "assistant" && now.vote === vote) this.dispatch({ type: "vote", messageId, vote: before });
      return false;
    }
  }

  /** Stop everything (the page is closing). */
  dispose(): void {
    this.disposed = true;
    this.cancelRetry();
    this.abort?.abort();
  }

  private forget(): void {
    this.conversationId = null;
    this.storage.clear();
  }

  private cancelRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private async body(question: UserRow): Promise<AskBody> {
    const { sessionId, provider } = this.options;
    const id = this.historyMode ? null : await this.ensureConversation();
    if (id) {
      const body = buildAskBody(question.text, [], question.scope, sessionId(), provider?.() ?? null);
      return { ...body, conversation_id: id, channel: question.channel };
    }
    this.historyMode = true;
    return buildAskBody(question.text, pastTurns(this.state.rows, question.key), question.scope, sessionId(), provider?.() ?? null);
  }

  /** One try of question `key`, start to finish. */
  private async attempt(key: string): Promise<void> {
    await Promise.race([this.ready, new Promise((r) => setTimeout(r, this.options.configWaitMs ?? CONFIG_WAIT_MS))]);
    if (this.disposed || this.state.pending !== key) return;
    const question = this.state.rows.find((r) => r.kind === "user" && r.key === key) as UserRow | undefined;
    if (!question) return;
    const body = await this.body(question);
    if (this.disposed || this.state.pending !== key) return;

    const controller = new AbortController();
    this.abort = controller;
    let answered = false;
    const waking = setTimeout(() => {
      if (!answered && this.state.pending === key) this.dispatch({ type: "waking" });
    }, this.options.wakingAfterMs ?? WAKING_AFTER_MS);
    const onData = (data: string) => {
      if (controller.signal.aborted || this.state.pending !== key) return;
      const parsed = parseEvent(data);
      if (parsed.kind !== "ok") {
        this.options.onSkipped?.(data, parsed.kind === "unknown" ? `unknown type ${parsed.type}` : parsed.reason);
        return;
      }
      if (parsed.event.type !== "sources") {
        answered = true;
        clearTimeout(waking);
      }
      this.dispatch({ type: "event", event: parsed.event });
    };
    try {
      await this.transport.send(body, onData, controller.signal);
      if (this.state.pending === key) this.dispatch({ type: "failed", failure: "ended", message: ENDED_EARLY });
    } catch (err) {
      if (this.state.pending !== key) return;
      if (controller.signal.aborted) {
        this.dispatch({ type: "failed", failure: "stopped", message: STOPPED });
        return;
      }
      this.recover(key, toFailure(err), Boolean(body.conversation_id));
    } finally {
      clearTimeout(waking);
      if (this.abort === controller) this.abort = null;
    }
  }

  private recover(key: string, failure: Failure, saved: boolean): void {
    const used = this.used.get(key) ?? new Set<FailureKind>();
    this.used.set(key, used);
    // A 404 without a saved conversation is an ordinary HTTP error, not a lost conversation.
    const kind: FailureKind = failure.kind === "gone" && !saved ? "http" : failure.kind;
    const action = recoveryFor({ ...failure, kind }, used);
    if (action.type === "show") {
      this.dispatch({ type: "failed", failure: kind, message: failure.message });
      return;
    }
    used.add(kind);
    this.dispatch({ type: "failed", failure: kind, message: failure.message, retrying: true });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.disposed || this.state.pending !== key) return;
      if (action.fresh) this.forget();
      this.dispatch({ type: "resend", replyTo: key });
      void this.attempt(key);
    }, action.delayMs);
  }
}

function toFailure(err: unknown): Failure {
  if (err instanceof TransportError) return { kind: err.kind, message: err.message, status: err.status, retryAfterS: err.retryAfterS };
  return { kind: "http", message: err instanceof Error ? err.message : "Something went wrong." };
}
