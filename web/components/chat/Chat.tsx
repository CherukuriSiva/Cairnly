"use client";

import { PlayCircle, SquarePen } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Composer } from "@/components/chat/Composer";
import { TurnView } from "@/components/chat/TurnView";
import { useFollow } from "@/components/chat/useFollow";
import { VoicePanel } from "@/components/chat/VoicePanel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { featuresOf, fetchConfig, getSessionId, NO_FEATURES, PROVIDER_LABELS, warmUp, type Provider } from "@/lib/ask";
import { ChatController } from "@/lib/chat/controller";
import { browserStorage, httpConversationApi } from "@/lib/chat/conversations";
import { groupTurns, initialChatState } from "@/lib/chat/reducer";
import { liveTransport } from "@/lib/chat/transport";
import { askHref, STARTERS } from "@/lib/starters";
import { SITE_NAME } from "@/lib/site";
import { browserVoiceAdapter } from "@/lib/voice/browser";
import { VOICE_URL, VoiceController } from "@/lib/voice/controller";
import { inCall, initialVoiceState } from "@/lib/voice/machine";
import type { Transport } from "@/lib/voice/types";

const noSubscribe = () => () => {};
const idleVoice = () => initialVoiceState;

/** ?transport=webrtc|websocket picks the voice transport (local testing); else the server's. */
function transportParam(): Transport | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("transport");
  return value === "webrtc" || value === "websocket" ? value : null;
}

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

/** A sample question; in the demo each one plays a recorded scenario, named by `label`. */
interface Starter {
  question: string;
  label?: string;
}

const LIVE_STARTERS: Starter[] = STARTERS.map((question) => ({ question }));

/** Says plainly that the demo replays recordings, with a way back to the live chat. */
function DemoNotice() {
  return (
    <div role="note" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm">
      <PlayCircle size={16} aria-hidden="true" className="shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-text">
        <span className="font-medium">Recorded demo.</span>{" "}
        <span className="text-muted">Answers are replayed from recordings of the real chat, not written live.</span>
      </p>
      <a href="/ask" className="font-medium text-accent underline decoration-border underline-offset-2 hover:decoration-accent">
        Use the live chat
      </a>
    </div>
  );
}

/** The chat at /ask. The turn logic lives in lib/chat (ChatController); this component renders
 * its rows and wires the page around it: GET /config (providers and optional features), the
 * shareable ?q= and ?track= links, the provider select, New chat, and ?demo=1, which replays
 * recorded answers so the chat can be shown while the API sleeps. */
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
  // Voice mode exists only when the site was built with NEXT_PUBLIC_VOICE_URL, and shows only
  // once that server says calls are possible (see the config effect below).
  const [voice] = useState(() =>
    VOICE_URL
      ? new VoiceController({
          baseUrl: VOICE_URL,
          adapter: browserVoiceAdapter(),
          chat: { ensureConversation: () => chat.ensureConversation(), reload: () => chat.reload() },
          transport: transportParam(),
        })
      : null,
  );
  const voiceState = useSyncExternalStore(voice?.subscribe ?? noSubscribe, voice?.getState ?? idleVoice, idleVoice);
  const calling = inCall(voiceState);
  const [input, setInput] = useState("");
  const [providers, setProviders] = useState<Provider[]>(["ollama"]);
  const [provider, setProvider] = useState<Provider>("ollama");
  const chooseProvider = providers.length > 1; // the select only appears when there is a choice
  const [track, setTrack] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [feedback, setFeedback] = useState(false); // vote buttons: only when the API has them
  const [starters, setStarters] = useState<Starter[]>(LIVE_STARTERS);
  const busy = state.status !== "idle";
  const page = useRef<HTMLElement>(null);
  const { toBottom } = useFollow(page);

  useEffect(() => {
    providerRef.current = chooseProvider ? provider : null;
  }, [chooseProvider, provider]);

  const submit = useCallback(
    (question: string, scope: string | null, newConversation = false) => {
      if (!question.trim() || chat.busy) return;
      setInput("");
      chat.send(question, scope, { newConversation });
      toBottom();
    },
    [chat, toBottom],
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
  // Without an answer the chat keeps its history in the tab, as older versions did. With
  // ?demo=1 the API is never called: the replay transport (loaded only then) plays recordings.
  useEffect(() => {
    let live = true;
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      setDemo(true);
      import("@/lib/chat/replay").then(({ replayTransport, SCENARIOS }) => {
        if (!live) return;
        setStarters(SCENARIOS.map((s) => ({ question: s.question, label: s.label })));
        chat.configure({ features: NO_FEATURES, conversations: null, transport: replayTransport() });
      });
      return () => {
        live = false;
      };
    }
    warmUp();
    fetchConfig().then((config) => {
      if (!live) return;
      if (config) {
        setProviders(config.providers);
        if (config.providers.includes(config.default_provider)) setProvider(config.default_provider);
      }
      const features = featuresOf(config);
      chat.configure(config ? { features, conversations: features.conversations ? httpConversationApi() : null } : null);
      setFeedback(chat.getFeatures().feedback);
      void chat.restore();
      // Voice turns are saved into the conversation, so voice needs saved conversations.
      if (voice && chat.getFeatures().conversations) void voice.checkStatus();
    });
    return () => {
      live = false;
    };
  }, [chat, voice]);

  // Leaving the page stops the stream and any pending retry. Dev StrictMode runs this cleanup and
  // the effect again in one go, so the stop waits a microtask and only a real unmount cancels.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current) {
          chat.dispose();
          voice?.dispose();
        }
      });
    };
  }, [chat, voice]);

  // "Type instead": end the call and put the caret in the box.
  function typeInstead() {
    void voice?.hangUp();
    requestAnimationFrame(() => document.getElementById("chat-input")?.focus());
  }

  const turns = groupTurns(state.rows);
  const Eyebrow = turns.length > 0 ? "h1" : "p";

  return (
    <main ref={page} className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-3xl flex-col px-4 pt-8">
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
      {demo && <DemoNotice />}

      {/* The transcript is a log, but not a live one: screen readers would read every token.
          Each finished answer (and each error) is announced once by the status region below. */}
      <section role="log" aria-live="off" aria-label="Conversation" className="flex-1 space-y-8 py-8">
        {turns.length === 0 && (
          <div>
            <SectionHeader
              as="h1"
              title="What do you want to learn?"
              description="Ask about the AI engineering lessons. Every answer links to the lessons it comes from."
            />
            <ul className="mt-8 grid gap-2 sm:grid-cols-2" aria-label="Sample questions">
              {starters.map(({ question, label }) => (
                <li key={question}>
                  <Link
                    href={askHref(question)}
                    onClick={(e) => {
                      e.preventDefault();
                      submit(question, track);
                    }}
                    className="block h-full rounded-xl border border-border bg-surface-1 px-4 py-3 text-sm text-text hover:border-accent"
                  >
                    {label && <span className="eyebrow mb-1 block text-faint">{label}</span>}
                    {question}
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
            onVote={feedback ? (id, vote, reason) => chat.vote(id, vote, reason) : undefined}
          />
        ))}
      </section>

      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {state.announcement && <p key={state.announcement.id}>{state.announcement.text}</p>}
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSubmit={() => submit(input, track)}
        onStop={() => chat.stop()}
        busy={busy}
        placeholder={turns.length ? "Ask a follow-up…" : "Ask a question…"}
        scopeTitle={track ? (trackTitles[track] ?? track) : null}
        onClearScope={clearScope}
        onVoice={voice && voiceState.available && !demo && !voiceState.closing ? () => voice.start() : undefined}
        voicePanel={
          voice && calling ? (
            <VoicePanel
              state={voiceState}
              onMute={() => voice.toggleMute()}
              onEnd={() => void voice.hangUp()}
              onTypeInstead={typeInstead}
              onRetry={() => voice.start()}
              onDismiss={() => voice.dismiss()}
            />
          ) : undefined
        }
        voiceNotice={
          voice && voiceState.phase === "idle" && voiceState.saidUnavailable && !demo ? (
            <p className="mb-2 text-xs text-muted">Voice isn&apos;t available right now.</p>
          ) : voice && (voiceState.phase === "ended" || voiceState.phase === "failed") ? (
            <VoicePanel
              state={voiceState}
              onMute={() => {}}
              onEnd={() => {}}
              onTypeInstead={() => {}}
              onRetry={() => voice.start()}
              onDismiss={() => voice.dismiss()}
            />
          ) : undefined
        }
      />
    </main>
  );
}
