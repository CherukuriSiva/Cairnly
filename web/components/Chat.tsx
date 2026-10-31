"use client";

import { useEffect, useRef, useState } from "react";
import {
  ask,
  buildAskBody,
  fetchConfig,
  getSessionId,
  PROVIDER_LABELS,
  type AskEvent,
  type PastTurn,
  type Provider,
  type Source,
} from "@/lib/ask";
import { inlineTokens } from "@/lib/inline";

interface Turn extends PastTurn {
  sources: Source[];
  meta?: string;
  searched?: string; // the rewritten query, shown when it differs from the question
  notice?: string;
  waking?: boolean; // no token yet after WAKING_MS: the model is probably starting up
}

const WAKING_MS = 5000;

const STARTERS = [
  "What is RAG, and when should I use it instead of fine-tuning?",
  "How do I evaluate an LLM app before I ship it?",
  "What is an AI agent, and when do I actually need one?",
  "How do I protect my app from prompt injection?",
  "How do tokens and context windows affect cost?",
  "Which projects should I build for an AI engineer portfolio?",
];

/** Remove one query parameter from the address bar without reloading. */
function dropParam(name: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete(name);
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

export function Chat({ trackTitles }: { trackTitles: Record<string, string> }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [providers, setProviders] = useState<Provider[]>(["ollama"]);
  const [provider, setProvider] = useState<Provider>("ollama");
  const chooseProvider = providers.length > 1; // the select only appears when there is a choice
  const [track, setTrack] = useState<string | null>(null);
  const busy = turns.at(-1)?.status === "streaming";
  const abortRef = useRef<AbortController | null>(null);

  // Shareable links: /?q=...&track=... sets the scope and asks once (even in dev StrictMode).
  const askedFromUrl = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const scope = params.get("track");
    const known = scope && scope in trackTitles ? scope : null;
    setTrack(known);
    const q = params.get("q");
    if (q && !askedFromUrl.current) {
      askedFromUrl.current = true;
      submit(q, known);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function update(fn: (t: Turn) => Turn) {
    setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
  }

  function clearScope() {
    setTrack(null);
    dropParam("track");
  }

  async function submit(question: string, scope: string | null = track) {
    if (!question.trim() || busy) return;
    const body = buildAskBody(
      question,
      turns,
      scope,
      getSessionId(),
      chooseProvider ? provider : null,
    );
    setInput("");
    setTurns((all) => [...all, { question, answer: "", sources: [], status: "streaming" }]);
    abortRef.current = new AbortController();
    // A cold GPU can take a while for the first token: say so instead of "Searching…".
    const waking = setTimeout(
      () => update((t) => (t.status === "streaming" && !t.answer ? { ...t, waking: true } : t)),
      WAKING_MS,
    );
    const onEvent = (e: AskEvent) => {
      if (e.type !== "sources") clearTimeout(waking);
      if (e.type === "sources") update((t) => ({ ...t, sources: e.sources }));
      else if (e.type === "token")
        update((t) => ({ ...t, answer: t.answer + e.text, waking: false }));
      else if (e.type === "retract")
        update((t) => ({ ...t, answer: e.message, status: "refused" }));
      else if (e.type === "error")
        update((t) => ({ ...t, status: "error", meta: e.message, waking: false }));
      else if (e.type === "done")
        update((t) => ({
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
      await ask(body, onEvent, abortRef.current.signal);
    } catch (err) {
      update((t) => ({ ...t, status: "error", meta: (err as Error).message, waking: false }));
    } finally {
      clearTimeout(waking);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-3xl flex-col px-4 py-8">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">cairnly</h1>
          <p className="text-sm text-[var(--muted)]">
            Ask questions about the AI engineering lessons. Every answer links to the lessons it
            comes from.
          </p>
        </div>
        {chooseProvider && (
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            className="shrink-0 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 pr-7 text-sm"
            aria-label="Model provider"
          >
            {providers.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        )}
      </header>

      <section className="flex-1 space-y-6">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-[var(--muted)]">Try one of these:</p>
            {STARTERS.map((q) => (
              <button
                key={q}
                onClick={() => submit(q)}
                className="block w-full rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-left text-sm hover:border-[var(--accent)]"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {turns.map((turn, i) => (
          <TurnView key={i} turn={turn} />
        ))}
      </section>

      <div className="sticky bottom-0 mt-6 bg-[var(--bg)] py-4">
        {track && (
          <p className="mb-2">
            <button
              type="button"
              onClick={clearScope}
              aria-label={`Remove scope ${trackTitles[track]}`}
              className="rounded-full border border-[var(--line)] px-3 py-1 text-xs text-[var(--accent)]"
            >
              Scoped to {trackTitles[track]} ×
            </button>
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={turns.length ? "Ask a follow-up…" : "Ask a question…"}
            className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]"
          />
          {busy ? (
            <button type="button" onClick={() => abortRef.current?.abort()}
              className="rounded-lg border border-[var(--line)] px-4 text-sm">
              Stop
            </button>
          ) : (
            <button type="submit" className="rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-white">
              Ask
            </button>
          )}
        </form>
      </div>
    </main>
  );
}

function SourceItem({ source, active }: { source: Source; active: boolean }) {
  const label = source.trail ? `${source.title} › ${source.trail}` : source.title;
  return (
    <li className={active ? "text-[var(--accent)]" : ""}>
      [{source.n}]{" "}
      {source.url ? (
        <a href={source.url} target="_blank" rel="noopener noreferrer"
          className="font-medium underline decoration-[var(--line)] underline-offset-2 hover:text-[var(--accent)]">
          {label}
        </a>
      ) : (
        <span className="font-medium">{label}</span>
      )}
    </li>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const [active, setActive] = useState<number | null>(null);
  return (
    <article className="space-y-3">
      <p className="font-medium">{turn.question}</p>
      <div className="whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--panel)] p-4 text-sm leading-relaxed">
        {turn.answer ? (
          <Cited text={turn.answer} onCite={setActive} />
        ) : (
          <span className="text-[var(--muted)]">
            {turn.waking ? "Waking up the model, the first answer can take up to a minute…" : "Searching…"}
          </span>
        )}
        {turn.status === "streaming" && turn.answer && <span className="animate-pulse">▍</span>}
      </div>
      {turn.sources.length > 0 && (
        <ol className="space-y-1 text-xs text-[var(--muted)]">
          {turn.sources.map((s) => (
            <SourceItem key={s.n} source={s} active={active === s.n} />
          ))}
        </ol>
      )}
      {turn.notice && <p className="text-xs italic text-[var(--muted)]">{turn.notice}</p>}
      {turn.meta && (
        <p className={`text-xs ${turn.status === "error" ? "text-red-500" : "text-[var(--muted)]"}`}>
          {turn.status === "refused" &&
            (turn.guard ? "Blocked by the safety check · " : "Not in the lessons · ")}
          {turn.searched && `Searched: ${turn.searched} · `}
          {turn.meta}
        </p>
      )}
    </article>
  );
}

// Renders "[2]" markers in the answer as clickable chips that highlight the matching source.
function Cited({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  return (
    <>
      {text.split(/(\[\d+\])/).map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (!m) return <Inline key={i} text={part} />;
        const n = Number(m[1]);
        return (
          <button key={i} onClick={() => onCite(n)}
            className="mx-0.5 rounded bg-[var(--line)] px-1 align-super text-[10px] font-medium text-[var(--accent)]">
            {n}
          </button>
        );
      })}
    </>
  );
}

// Minimal inline markdown for answers (see lib/inline.ts). Everything else stays plain text
// (newlines are kept by whitespace-pre-wrap). Rendered as React elements, never as raw HTML.
function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineTokens(text).map((token, i) => {
        if (token.kind === "bold") return <strong key={i}>{token.text}</strong>;
        if (token.kind === "italic") return <em key={i}>{token.text}</em>;
        if (token.kind === "code")
          return (
            <code key={i} className="rounded bg-[var(--line)] px-1 text-[0.9em]">
              {token.text}
            </code>
          );
        return <span key={i}>{token.text}</span>;
      })}
    </>
  );
}
