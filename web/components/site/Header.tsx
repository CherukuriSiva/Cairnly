"use client";

import { Menu, MessageCircle, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { openPalette, preloadPalette } from "@/components/site/PaletteHost";
import { Drawer } from "@/components/ui/Drawer";
import { Logo } from "@/components/ui/Logo";
import { activeHref, NAV_LINKS } from "@/lib/nav";
import { SITE_NAME } from "@/lib/site";

const ASK_BUTTON =
  "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-strong";

/** "⌘K" on Apple devices, "Ctrl K" elsewhere. Decided after mount (the server cannot know). */
function useShortcutLabel(): string {
  const [label, setLabel] = useState("⌘K");
  useEffect(() => {
    if (!/Mac|iPhone|iPad|iPod/.test(navigator.userAgent)) setLabel("Ctrl K");
  }, []);
  return label;
}

/** The sticky header on every page: logo, section links with the active one marked, Search
 * (opens the ⌘K palette) and Ask. Below 768px the links move into a side sheet. */
export function Header({ trackIds }: { trackIds: string[] }) {
  const pathname = usePathname() ?? "/";
  const active = activeHref(pathname, trackIds);
  const shortcut = useShortcutLabel();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-[color-mix(in_srgb,var(--bg)_75%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => {
            const current = link.href === active;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  current ? "bg-surface-2 text-text" : "text-muted hover:text-text"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <button
            type="button"
            onClick={openPalette}
            onPointerEnter={preloadPalette}
            onFocus={preloadPalette}
            aria-haspopup="dialog"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-1 py-1.5 pl-3 pr-2 text-sm text-muted hover:border-border-strong hover:text-text"
          >
            <Search size={15} aria-hidden="true" />
            Search
            <kbd className="rounded border border-border bg-surface-2 px-1.5 font-mono text-[11px] text-faint">{shortcut}</kbd>
          </button>
          <Link href="/ask" className={ASK_BUTTON}>
            <MessageCircle size={15} aria-hidden="true" />
            Ask
          </Link>
        </div>
        <div className="ml-auto flex items-center gap-1 md:hidden">
          <button
            type="button"
            onClick={openPalette}
            onPointerDown={preloadPalette}
            aria-label="Search"
            aria-haspopup="dialog"
            className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text"
          >
            <Search size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
        </div>
      </div>
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} label="Menu" side="right">
        <nav aria-label="Main" className="flex flex-col gap-1 p-4">
          {NAV_LINKS.map((link) => {
            const current = link.href === active;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={`rounded-lg px-3 py-2.5 text-base ${current ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              openPalette();
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted"
          >
            <Search size={15} aria-hidden="true" />
            Search
          </button>
          <Link href="/ask" className={`${ASK_BUTTON} justify-center py-2`}>
            <MessageCircle size={15} aria-hidden="true" />
            Ask {SITE_NAME}
          </Link>
        </div>
      </Drawer>
    </header>
  );
}
