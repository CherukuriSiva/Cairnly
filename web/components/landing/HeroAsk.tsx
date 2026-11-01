"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { askHref, STARTERS } from "@/lib/starters";

const ROTATE_MS = 4000;

/** The landing page's ask box. Its placeholder cycles through the sample questions every 4 s,
 * paused while the box is focused or holds text, and still under reduced motion. Submitting
 * opens the chat at /ask with the question. */
export function HeroAsk() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (focused || value) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % STARTERS.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [focused, value]);

  return (
    <form
      role="search"
      aria-label="Ask cairnly"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(value.trim() ? askHref(value.trim()) : "/ask");
      }}
      className="flex w-full items-center gap-2 rounded-2xl border border-border-strong bg-surface-1 p-1.5 shadow-[0_12px_40px_-20px_var(--accent-glow)] focus-within:border-accent"
    >
      <label htmlFor="hero-ask" className="sr-only">
        Ask a question about AI engineering
      </label>
      <input
        id="hero-ask"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={STARTERS[index]}
        autoComplete="off"
        className="h-14 min-w-0 flex-1 bg-transparent px-3 text-base text-text outline-none placeholder:text-faint focus-visible:outline-none"
      />
      <button
        type="submit"
        className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-strong sm:px-5"
      >
        Ask
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </form>
  );
}
