"use client";

import { SquarePen } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Composer } from "@/components/chat/Composer";
import { TurnView } from "@/components/chat/TurnView";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { featuresOf, fetchConfig, getSessionId, PROVIDER_LABELS, warmUp, type Provider } from "@/lib/ask";
import { ChatController } from "@/lib/chat/controller";
import { browserStorage, httpConversationApi } from "@/lib/chat/conversations";
import { groupTurns, initialChatState } from "@/lib/chat/reducer";
import { liveTransport } from "@/lib/chat/transport";
import { askHref, STARTERS } from "@/lib/starters";
import { SITE_NAME } from "@/lib/site";

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

/** The chat at /ask. The turn logic lives in lib/chat (ChatController); this component renders
 * its rows and wires the page around it: GET /config (providers and optional features), the
 * shareable ?q= and ?track= links, the provider select and New chat. */
export function Chat({ trackTitles }: { trackTitles: Record<string, string> }) {
  const providerRef = useRef<Provider | null>(null);
  const [chat] = useState(
    () =>
      new ChatController({
        transport: liveTransport(),
        sessionId: getSessionId,
        provider: () => providerRef.current,
        storage: browserStorage,
      }),
  );
  const state = useSyncExternalStore(chat.subscribe, chat.getState, () => initialChatState);
  const [input, setInput] = useState("");
  const [providers, setProviders] = useState<Provider[]>(["ollama"]);
  const [provider, setProvider] = useState<Provider>("ollama");
  const chooseProvider = providers.length > 1; // the select only appears when there is a choice
  const [track, setTrack] = useState<string | null>(null);
  const busy = state.status !== "idle";

  useEffect(() => {
    providerRef.current = chooseProvider ? provider : null;
  }, [chooseProvider, provider]);

  const submit = useCallback(
    (question: string, scope: string | null, newConversation = false) => {
      if (!question.trim() || chat.busy) return;
      setInput("");
      chat.send(question, scope, { newConversation });
    },
    [chat],
  );

  function newChat() {
    chat.newChat();
    setInput("");
  }

  function clearScope() {
    setTrack(null);
    dropParam("track");
  }

  // Shareable links: /ask?q=...&track=... sets the scope and asks each new q once (a second run
  // with the same q, from dev StrictMode or a track change, does not ask again). A link opened
  // with the page starts a new conversation; a q pushed while the chat is open follows up.
  const askedQ = useRef<string | null | undefined>(undefined);
  const applyUrl = useCallback(
    (q: string | null, scope: string | null) => {
      const known = scope && scope in trackTitles ? scope : null;
      setTrack(known);
      if (q && q !== askedQ.current) submit(q, known, askedQ.current === undefined);
      askedQ.current = q;
    },
    [trackTitles, submit],
  );

  // Model, best match and rewritten query under each answer: in development or with ?debug=1.
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    setDebug(process.env.NODE_ENV === "development" || new URLSearchParams(window.location.search).get("debug") === "1");
  }, []);

  // Wake the API, ask what it offers, then restore the saved conversation (newer APIs only).
  // Without an answer the chat keeps its history in the tab, as older versions did.
  useEffect(() => {
    warmUp();
    let live = true;
    fetchConfig().then((config) => {
      if (!live) return;
      if (config) {
        setProviders(config.providers);
        if (config.providers.includes(config.default_provider)) setProvider(config.default_provider);
      }
      const features = featuresOf(config);
      chat.configure(config ? { features, conversations: features.conversations ? httpConversationApi() : null } : null);
      void chat.restore();
    });
    return () => {
      live = false;
    };
  }, [chat]);

  // Leaving the page stops the stream and any pending retry. Dev StrictMode runs this cleanup and
  // the effect again in one go, so the stop waits a microtask and only a real unmount cancels.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) chat.dispose();
      });
    };
  }, [chat]);

  const turns = groupTurns(state.rows);
  const Eyebrow = turns.length > 0 ? "h1" : "p";

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-3xl flex-col px-4 pt-8">
      <Suspense fallback={null}>
        <UrlParams onChange={applyUrl} />
      </Suspense>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* The page heading once the empty state (and its h1) gives way to the conversation. */}
        <Eyebrow className="eyebrow text-faint">Ask {SITE_NAME}</Eyebrow>
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
        {turns.map(({ question, replies }) => (
          <TurnView
            key={question.key}
            question={question}
            replies={replies}
            pending={state.pending === question.key}
            waking={state.waking}
            busy={busy}
            debug={debug}
            onRetry={(key) => chat.retry(key)}
          />
        ))}
      </section>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={() => submit(input, track)}
        onStop={() => chat.stop()}
        busy={busy}
        placeholder={turns.length ? "Ask a follow-up…" : "Ask a question…"}
        scopeTitle={track ? (trackTitles[track] ?? track) : null}
        onClearScope={clearScope}
      />
    </main>
  );
}
