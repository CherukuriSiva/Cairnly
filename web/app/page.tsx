"use client";

import { useEffect, useRef, useState } from "react";
import { ask, listKbs, type AskEvent, type KnowledgeBase, type Provider, type Source } from "@/lib/ask";

interface Turn {
  question: string;
  answer: string;
  sources: Source[];
  status: "streaming" | "done" | "refused" | "error";
  meta?: string;
  notice?: string;
}

const EXAMPLES = [
  "What is RAG and when does it beat pure prompting?",
  "How should I plan my first 6 months in tech?",
  "What's the difference between fine-tuning and RAG?",
];

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState<Provider>("ollama");
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [kb, setKb] = useState("lessons");

  useEffect(() => {
    listKbs().then(setKbs).catch(() => setKbs([]));
  }, []);
  const busy = turns.at(-1)?.status === "streaming";
  const abortRef = useRef<AbortController | null>(null);

  // Shareable links: /?q=What+is+RAG asks that question on load (once, even in dev StrictMode).
  const askedFromUrl = useRef(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && !askedFromUrl.current) {
      askedFromUrl.current = true;
      submit(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(fn: (t: Turn) => Turn) {
    setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
  }

  async function submit(question: string) {
    if (!question.trim() || busy) return;
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
          notice: e.notice || undefined,
        }));
    };
    try {
      await ask(question, kb, provider, onEvent, abortRef.current.signal);
    } catch (err) {
      update((t) => ({ ...t, status: "error", meta: (err as Error).message }));
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">cairnly</h1>
          <p className="text-sm text-[var(--muted)]">Ask the docs. Every answer cites its sources.</p>
        </div>
        <div className="flex min-w-0 gap-2">
        {kbs.length > 1 && (
          <select
            value={kb}
            onChange={(e) => setKb(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-sm sm:flex-none"
            aria-label="Knowledge base"
          >
            {kbs.map((k) => (
              <option key={k.name} value={k.name}>{k.title}</option>
            ))}
          </select>
        )}
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as Provider)}
          className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-sm sm:flex-none"
          aria-label="Model provider"
        >
          <option value="ollama">Local (Ollama)</option>
          <option value="anthropic">Claude API</option>
        </select>
        </div>
      </header>

      <section className="flex-1 space-y-6">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-[var(--muted)]">Try one of these:</p>
            {EXAMPLES.map((q) => (
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="sticky bottom-0 mt-6 flex gap-2 bg-[var(--bg)] py-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4 py-3 text-sm outline-none focus:border-[var(--accent)]"
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
    </main>
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
            <li key={s.n} className={active === s.n ? "text-[var(--accent)]" : ""}>
              [{s.n}] <span className="font-medium">{s.title}</span>
              {s.trail && ` › ${s.trail}`} <span className="opacity-70">({s.path}:{s.lines[0]}-{s.lines[1]})</span>
            </li>
          ))}
        </ol>
      )}
      {turn.notice && <p className="text-xs italic text-[var(--muted)]">{turn.notice}</p>}
      {turn.meta && (
        <p className={`text-xs ${turn.status === "error" ? "text-red-500" : "text-[var(--muted)]"}`}>
          {turn.status === "refused" && "Not in the knowledge base · "}
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

// Minimal inline markdown for answers: **bold** and `code`. Everything else stays plain text
// (newlines are kept by whitespace-pre-wrap). Rendered as React elements, never as raw HTML.
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
          return <strong key={i}>{part.slice(2, -2)}</strong>;
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
