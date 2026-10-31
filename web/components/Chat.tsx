"use client";

import { useEffect, useRef, useState } from "react";
import { ask, buildAskBody, type AskEvent, type PastTurn, type Provider, type Source } from "@/lib/ask";

interface Turn extends PastTurn {
  sources: Source[];
  meta?: string;
  searched?: string; // the rewritten query, shown when it differs from the question
  notice?: string;
}

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
  const [provider, setProvider] = useState<Provider>("ollama");
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

  function update(fn: (t: Turn) => Turn) {
    setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
  }

  function clearScope() {
    setTrack(null);
    dropParam("track");
  }

  async function submit(question: string, scope: string | null = track) {
    if (!question.trim() || busy) return;
    const body = buildAskBody(question, turns, scope, provider);
    setInput("");
    setTurns((all) => [...all, { question, answer: "", sources: [], status: "streaming" }]);
    abortRef.current = new AbortController();
    const onEvent = (e: AskEvent) => {
      if (e.type === "sources") update((t) => ({ ...t, sources: e.sources }));
      else if (e.type === "token") update((t) => ({ ...t, answer: t.answer + e.text }));
      else if (e.type === "error") update((t) => ({ ...t, status: "error", meta: e.message }));
      else if (e.type === "done")
        update((t) => ({
          ...t,
          status: e.refused ? "refused" : "done",
          meta: `${e.model} · best match ${e.top_similarity.toFixed(2)}`,
          searched: e.query && e.query !== t.question ? e.query : undefined,
          notice: e.notice || undefined,
        }));
    };
    try {
      await ask(body, onEvent, abortRef.current.signal);
    } catch (err) {
      update((t) => ({ ...t, status: "error", meta: (err as Error).message }));
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
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as Provider)}
          className="shrink-0 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 pr-7 text-sm"
          aria-label="Model provider"
        >
          <option value="ollama">Local (Ollama)</option>
          <option value="anthropic">Claude API</option>
        </select>
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
        {turn.answer ? <Cited text={turn.answer} onCite={setActive} /> : <span className="text-[var(--muted)]">Searching…</span>}
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
          {turn.status === "refused" && "Not in the lessons · "}
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

// Minimal inline markdown for answers: **bold**, *italic* and `code`. Everything else stays plain
// text (newlines are kept by whitespace-pre-wrap). Rendered as React elements, never as raw HTML.
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/).map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
          return <em key={i}>{part.slice(1, -1)}</em>;
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
          return (
            <code key={i} className="rounded bg-[var(--line)] px-1 text-[0.9em]">
              {part.slice(1, -1)}
            </code>
          );
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
