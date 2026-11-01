"use client";

import { SquarePen } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Composer } from "@/components/chat/Composer";
import { TurnView, type ChatTurn } from "@/components/chat/TurnView";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  ask,
  AskError,
  AUTO_RETRY_DELAY_MS,
  buildAskBody,
  closeTurn,
  fetchConfig,
  getSessionId,
  PROVIDER_LABELS,
  shouldAutoRetry,
  type AskEvent,
  type Provider,
} from "@/lib/ask";
import { askHref, STARTERS } from "@/lib/starters";

const WAKING_MS = 5000; // no token yet after this: the model is probably starting up
const STOPPED = "Stopped.";

/** Remove one query parameter from the address bar without reloading. */
function dropParam(name: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete(name);
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

/** Reports ?q= and ?track= on mount and on every change (the palette can push a new q while
 * /ask is open). It sits in its own Suspense boundary so the rest of the chat stays static HTML. */
function UrlParams({ onChange }: { onChange: (q: string | null, track: string | null) => void }) {
  const params = useSearchParams();
  const q = params.get("q");
  const track = params.get("track");
  useEffect(() => onChange(q, track), [q, track, onChange]);
  return null;
}

/** The chat at /ask. Answers stream in; a cold start or a network failure shows a friendly
 * card and retries once by itself after 3 s; Retry asks again in place of the failed turn. */
export function Chat({ trackTitles }: { trackTitles: Record<string, string> }) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [providers, setProviders] = useState<Provider[]>(["ollama"]);
  const [provider, setProvider] = useState<Provider>("ollama");
  const chooseProvider = providers.length > 1; // the select only appears when there is a choice
  const [track, setTrack] = useState<string | null>(null);
  const busy = turns.some((t) => t.status === "streaming" || t.retrying);

  const turnsRef = useRef<ChatTurn[]>([]);
  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const providerRef = useRef<Provider | null>(null);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  useEffect(() => {
    providerRef.current = chooseProvider ? provider : null;
  }, [chooseProvider, provider]);

  const updateTurn = useCallback((id: number, fn: (t: ChatTurn) => ChatTurn) => {
    setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const cancelRetry = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  /** Stream one attempt of a turn. `before` is the conversation before it (its history). */
  const run = useCallback(
    async (id: number, question: string, scope: string | null, attempt: number, before: ChatTurn[]) => {
      const body = buildAskBody(question, before, scope, getSessionId(), providerRef.current);
      const controller = new AbortController();
      abortRef.current = controller;
      // A cold GPU can take a while for the first token: say so instead of only the dots.
      const waking = setTimeout(
        () => updateTurn(id, (t) => (t.status === "streaming" && !t.answer ? { ...t, waking: true } : t)),
        WAKING_MS,
      );
      const onEvent = (e: AskEvent) => {
        if (e.type !== "sources") clearTimeout(waking);
        if (e.type === "sources") updateTurn(id, (t) => ({ ...t, sources: e.sources }));
        else if (e.type === "token") updateTurn(id, (t) => ({ ...t, answer: t.answer + e.text, waking: false }));
        else if (e.type === "retract") updateTurn(id, (t) => ({ ...t, answer: e.message, status: "refused" }));
        else if (e.type === "error") updateTurn(id, (t) => ({ ...t, status: "error", meta: e.message, waking: false }));
        else if (e.type === "done")
          updateTurn(id, (t) => ({
            ...t,
            status: e.refused ? "refused" : "done",
            waking: false,
            meta:
              `${e.model} · best match ${e.top_similarity.toFixed(2)}` +
              (e.uncited ? " · no citations, check the sources" : ""),
            searched: e.query && e.query !== t.question ? e.query : undefined,
            notice: e.notice || undefined,
            guard: e.guard || undefined,
          }));
      };
      try {
        await ask(body, onEvent, controller.signal);
        updateTurn(id, closeTurn); // the stream closed without a done or error event
      } catch (err) {
        if (controller.signal.aborted) {
          updateTurn(id, (t) => ({ ...t, status: "error", meta: STOPPED, errorKind: undefined, waking: false }));
          return;
        }
        const kind = err instanceof AskError ? err.kind : "http";
        const auto = shouldAutoRetry(kind, attempt);
        updateTurn(id, (t) => ({ ...t, status: "error", meta: (err as Error).message, errorKind: kind, waking: false, retrying: auto }));
        if (auto) {
          retryTimer.current = setTimeout(() => {
            retryTimer.current = null;
            retryRef.current(id);
          }, AUTO_RETRY_DELAY_MS);
        }
      } finally {
        clearTimeout(waking);
      }
    },
    [updateTurn],
  );

  /** Ask a failed turn again, in its place, with the same question and scope. */
  const retry = useCallback(
    (id: number) => {
      cancelRetry();
      const all = turnsRef.current;
      const index = all.findIndex((t) => t.id === id);
      if (index < 0 || all.some((t) => t.status === "streaming")) return;
      const failed = all[index];
      const attempt = failed.attempt + 1;
      updateTurn(id, (t) => ({
        id: t.id,
        question: t.question,
        scope: t.scope,
        attempt,
        answer: "",
        sources: [],
        status: "streaming",
      }));
      run(id, failed.question, failed.scope, attempt, all.slice(0, index));
    },
    [cancelRetry, run, updateTurn],
  );
  // The automatic retry runs from a timer; it calls the latest retry through this ref.
  const retryRef = useRef(retry);
  useEffect(() => {
    retryRef.current = retry;
  }, [retry]);

  const submit = useCallback(
    (question: string, scope: string | null) => {
      const all = turnsRef.current;
      if (!question.trim() || all.some((t) => t.status === "streaming" || t.retrying)) return;
      const id = nextId.current++;
      setInput("");
      const turn: ChatTurn = { id, question, scope, attempt: 1, answer: "", sources: [], status: "streaming" };
      turnsRef.current = [...all, turn];
      setTurns(turnsRef.current);
      run(id, question, scope, 1, all);
    },
    [run],
  );

  function stop() {
    cancelRetry();
    abortRef.current?.abort();
    setTurns((all) => all.map((t) => (t.retrying ? { ...t, retrying: false } : t)));
  }

  function newChat() {
    cancelRetry();
    abortRef.current?.abort();
    abortRef.current = null;
    turnsRef.current = [];
    setTurns([]);
    setInput("");
  }

  function clearScope() {
    setTrack(null);
    dropParam("track");
  }

  // Shareable links: /ask?q=...&track=... sets the scope and asks each new q once (a second run
  // with the same q, from dev StrictMode or a track change, does not ask again).
  const askedQ = useRef<string | null>(null);
  const applyUrl = useCallback(
    (q: string | null, scope: string | null) => {
      const known = scope && scope in trackTitles ? scope : null;
      setTrack(known);
      if (q && q !== askedQ.current) submit(q, known);
      askedQ.current = q;
    },
    [trackTitles, submit],
  );

  // Which providers this server allows. Without an answer, the chat uses the server default.
  useEffect(() => {
    let live = true;
    fetchConfig().then((config) => {
      if (!live || !config) return;
      setProviders(config.providers);
      if (config.providers.includes(config.default_provider)) setProvider(config.default_provider);
    });
    return () => {
      live = false;
    };
  }, []);

  // Leaving the page stops the stream and any pending retry. Dev StrictMode runs this cleanup and
  // the effect again in one go, so the abort waits a microtask and only a real unmount cancels.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (mounted.current) return;
        cancelRetry();
        abortRef.current?.abort();
      });
    };
  }, [cancelRetry]);

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-3xl flex-col px-4 pt-8">
      <Suspense fallback={null}>
        <UrlParams onChange={applyUrl} />
      </Suspense>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow text-faint">Ask cairnly</p>
        <div className="flex items-center gap-2">
          {chooseProvider && (
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              className="rounded-lg border border-border bg-surface-1 px-2 py-1.5 pr-7 text-sm text-text"
              aria-label="Model provider"
            >
              {providers.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={newChat}
            disabled={turns.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 py-1.5 text-sm text-muted hover:text-text disabled:opacity-50"
          >
            <SquarePen size={14} aria-hidden="true" />
            New chat
          </button>
        </div>
      </div>

      <section aria-label="Conversation" className="flex-1 space-y-8 py-8">
        {turns.length === 0 && (
          <div>
            <SectionHeader
              as="h1"
              title="What do you want to learn?"
              description="Ask about the AI engineering lessons. Every answer links to the lessons it comes from."
            />
            <ul className="mt-8 grid gap-2 sm:grid-cols-2" aria-label="Sample questions">
              {STARTERS.map((q) => (
                <li key={q}>
                  <Link
                    href={askHref(q)}
                    onClick={(e) => {
                      e.preventDefault();
                      submit(q, track);
                    }}
                    className="block h-full rounded-xl border border-border bg-surface-1 px-4 py-3 text-sm text-text hover:border-accent"
                  >
                    {q}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} busy={busy} onRetry={() => retry(turn.id)} />
        ))}
      </section>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={() => submit(input, track)}
        onStop={stop}
        busy={busy}
        placeholder={turns.length ? "Ask a follow-up…" : "Ask a question…"}
        scopeTitle={track ? (trackTitles[track] ?? track) : null}
        onClearScope={clearScope}
      />
    </main>
  );
}
