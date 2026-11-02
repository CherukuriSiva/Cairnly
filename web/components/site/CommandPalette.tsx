"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { BookOpen, ChevronDown, FileText, MessageCircle, Route, Search, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, Skeleton } from "@/components/ui/EmptyState";
import { rankItems, type SearchItem, type SearchKind } from "@/lib/searchIndex";
import { SITE_NAME } from "@/lib/site";
import { askHref } from "@/lib/starters";

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

const GROUPS: { type: SearchKind; heading: string; noun: string; icon: LucideIcon }[] = [
  { type: "lesson", heading: "Lessons", noun: "lessons", icon: BookOpen },
  { type: "roadmap", heading: "Roadmaps", noun: "roadmaps", icon: Route },
  { type: "insight", heading: "Insights", noun: "insights", icon: FileText },
];

/** Results shown per group until "Show all". */
const GROUP_CAP = 6;
const ASK_VALUE = "ask";

const ITEM =
  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-text data-[selected=true]:bg-surface-2";

/** The ⌘K palette: search lessons, roadmaps and insights, or ask Cairnly the typed question.
 * Filtering is ours (lib/searchIndex rankItems), not cmdk's fuzzy match: results are grouped,
 * capped at six per group with "Show all", and the list goes back to the top on every query. */
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
  const [expanded, setExpanded] = useState<SearchKind[]>([]);
  const [selected, setSelected] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const asked = query.trim();

  useEffect(() => {
    if (!open || items) return;
    let live = true;
    loadIndex().then((index) => live && setItems(index));
    return () => {
      live = false;
    };
  }, [open, items]);

  const groups = useMemo(() => {
    const ranked = rankItems(items ?? [], query);
    return GROUPS.map((group) => ({ ...group, results: ranked.filter((item) => item.type === group.type) })).filter(
      (group) => group.results.length > 0,
    );
  }, [items, query]);
  const matches = groups.reduce((n, g) => n + g.results.length, 0);

  // A new query starts over: groups collapse, the first row is selected, the list is at the top.
  function search(next: string) {
    setQuery(next);
    setExpanded([]);
    const first = next.trim() ? ASK_VALUE : "";
    setSelected(first);
    if (listRef.current) listRef.current.scrollTop = 0;
  }

  // With an empty query nothing is pinned, so select the first result once the index is in.
  useEffect(() => {
    if (!selected && groups[0]) setSelected(groups[0].results[0].href);
  }, [selected, groups]);

  function go(href: string) {
    onOpenChange(false);
    search("");
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
          <Command label={`Search ${SITE_NAME}`} shouldFilter={false} value={selected} onValueChange={setSelected}>
            {/* The focus cue is the row's accent underline: the global outline would be clipped. */}
            <div className="flex items-center gap-2 border-b border-border px-4 focus-within:border-accent">
              <Search size={16} aria-hidden="true" className="shrink-0 text-faint" />
              <Command.Input
                value={query}
                onValueChange={search}
                placeholder="Search lessons, roadmaps and insights…"
                style={{ outline: "none" }}
                className="h-12 w-full bg-transparent text-base text-text placeholder:text-faint"
              />
            </div>
            <Command.List ref={listRef} className="max-h-[60vh] overflow-y-auto overscroll-contain p-2">
              {asked && (
                <Command.Item value={ASK_VALUE} onSelect={() => go(askHref(asked))} className={ITEM}>
                  <MessageCircle size={16} aria-hidden="true" className="shrink-0 text-accent" />
                  <span className="min-w-0 truncate">
                    Ask {SITE_NAME}: <span className="font-medium">&ldquo;{asked}&rdquo;</span>
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
              ) : matches === 0 ? (
                <div className="p-2">
                  <EmptyState title="Nothing matches" text={`Try a shorter search, or ask ${SITE_NAME} instead.`} />
                </div>
              ) : (
                groups.map(({ type, heading, noun, icon: Icon, results }) => {
                  const all = expanded.includes(type);
                  const shown = all ? results : results.slice(0, GROUP_CAP);
                  return (
                    <Command.Group
                      key={type}
                      heading={heading}
                      className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-faint"
                    >
                      {shown.map((item) => (
                        <Command.Item key={item.href} value={item.href} onSelect={() => go(item.href)} className={ITEM}>
                          <Icon size={16} aria-hidden="true" className="shrink-0 text-faint" />
                          <span className="min-w-0 flex-1 truncate">{item.title}</span>
                          <span className="hidden shrink-0 font-mono text-xs text-faint sm:inline">{item.meta}</span>
                        </Command.Item>
                      ))}
                      {!all && results.length > GROUP_CAP && (
                        <Command.Item
                          value={`show-all-${type}`}
                          onSelect={() => {
                            setExpanded((kinds) => [...kinds, type]);
                            setSelected(results[GROUP_CAP].href); // the first row it reveals
                          }}
                          className={`${ITEM} text-muted`}
                        >
                          <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-faint" />
                          Show all {results.length} {noun}
                        </Command.Item>
                      )}
                    </Command.Group>
                  );
                })
              )}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
