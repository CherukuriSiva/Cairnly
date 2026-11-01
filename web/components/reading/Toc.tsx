"use client";

import { ChevronDown } from "lucide-react";
import { useScrollSpy } from "@/components/reading/useScrollSpy";
import type { OutlineItem } from "@/lib/outline";

function TocList({ items, active }: { items: OutlineItem[]; active: string | null }) {
  return (
    <ul className="space-y-0.5 text-sm">
      {items.map((item) => {
        const current = item.id === active;
        return (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={current ? "location" : undefined}
              className={`block border-l-2 py-1 pr-2 leading-snug ${item.depth === 3 ? "pl-6" : "pl-3"} ${
                current ? "border-accent text-accent" : "border-transparent text-muted hover:text-text"
              }`}
            >
              {item.text}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** "On this page": a sticky list at xl that marks the section being read, and a collapsible
 * list at the top of the content below xl. */
export function Toc({ items, placement }: { items: OutlineItem[]; placement: "aside" | "inline" }) {
  const active = useScrollSpy(placement === "aside" ? items.map((i) => i.id) : []);
  if (items.length === 0) return null;
  if (placement === "inline") {
    return (
      <details className="group mb-8 rounded-2xl border border-border bg-surface-1 px-4 xl:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between py-3 [&::-webkit-details-marker]:hidden">
          <span className="eyebrow text-faint">On this page</span>
          <ChevronDown size={16} aria-hidden="true" className="text-faint transition-transform group-open:rotate-180" />
        </summary>
        <nav aria-label="On this page" className="pb-3">
          <TocList items={items} active={null} />
        </nav>
      </details>
    );
  }
  return (
    <nav aria-label="On this page" className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
      <p className="eyebrow mb-3 pl-3 text-faint">On this page</p>
      <TocList items={items} active={active} />
    </nav>
  );
}
