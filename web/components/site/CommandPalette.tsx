"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { BookOpen, FileText, MessageCircle, Route, Search, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";
import type { SearchItem, SearchKind } from "@/lib/searchIndex";
import { SITE_NAME } from "@/lib/site";

// Fetched once per page load, on the first open, then kept here.
let cached: Promise<SearchItem[]> | null = null;

function loadIndex(): Promise<SearchItem[]> {
  cached ??= fetch("/search-index.json")
    .then((res) => (res.ok ? (res.json() as Promise<SearchItem[]>) : []))
    .catch(() => {
      cached = null; // try again on the next open
      return [];
    });
  return cached;
}

const GROUPS: { type: SearchKind; heading: string; icon: LucideIcon }[] = [
  { type: "lesson", heading: "Lessons", icon: BookOpen },
  { type: "roadmap", heading: "Roadmaps", icon: Route },
  { type: "insight", heading: "Insights", icon: FileText },
];

const ITEM =
  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-text data-[selected=true]:bg-surface-2";

/** The ⌘K palette: search lessons, roadmaps and insights, or ask Cairnly the typed question. */
export default function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || items) return;
    let live = true;
    loadIndex().then((index) => live && setItems(index));
    return () => {
      live = false;
    };
  }, [open, items]);

  function go(href: string) {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-2xl"
        >
          <Dialog.Title className="sr-only">Search {SITE_NAME}</Dialog.Title>
          <Command label={`Search ${SITE_NAME}`}>
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search size={16} aria-hidden="true" className="shrink-0 text-faint" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search lessons, roadmaps and insights…"
                className="h-12 w-full bg-transparent text-base text-text outline-none placeholder:text-faint"
              />
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto overscroll-contain p-2">
              {query.trim() && (
                <Command.Item
                  forceMount
                  value={`ask ${query}`}
                  onSelect={() => go(`/ask?q=${encodeURIComponent(query.trim())}`)}
                  className={ITEM}
                >
                  <MessageCircle size={16} aria-hidden="true" className="shrink-0 text-accent" />
                  <span className="min-w-0 truncate">
                    Ask {SITE_NAME}: <span className="font-medium">{query.trim()}</span>
                  </span>
                </Command.Item>
              )}
              {items === null ? (
                <Command.Loading label="Loading the index">
                  <div className="space-y-2 p-2">
                    <Skeleton className="h-8" />
                    <Skeleton className="h-8" />
                    <Skeleton className="h-8" />
                  </div>
                </Command.Loading>
              ) : (
                <>
                  <Command.Empty>
                    <EmptyState title="Nothing matches" text={`Try a shorter search, or ask ${SITE_NAME} instead.`} />
                  </Command.Empty>
                  {GROUPS.map(({ type, heading, icon: Icon }) => (
                    <Command.Group
                      key={type}
                      heading={heading}
                      className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-faint"
                    >
                      {items
                        .filter((item) => item.type === type)
                        .map((item) => (
                          <Command.Item
                            key={item.href}
                            value={item.href}
                            keywords={[item.title, item.meta]}
                            onSelect={() => go(item.href)}
                            className={ITEM}
                          >
                            <Icon size={16} aria-hidden="true" className="shrink-0 text-faint" />
                            <span className="min-w-0 flex-1 truncate">{item.title}</span>
                            <span className="hidden shrink-0 font-mono text-xs text-faint sm:inline">{item.meta}</span>
                          </Command.Item>
                        ))}
                    </Command.Group>
                  ))}
                </>
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
