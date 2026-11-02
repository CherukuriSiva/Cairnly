"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const OPEN_EVENT = "cairnly:open-palette";

// cmdk loads only when the palette first opens, so it is not in every page's first-load JS.
const loadPalette = () => import("@/components/site/CommandPalette");
const CommandPalette = dynamic(loadPalette, { ssr: false });

/** Open the command palette from anywhere (the header's Search buttons). */
export function openPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Start loading the palette's code before it is needed (Search button hover or focus), so the
 * first open is instant. */
export function preloadPalette() {
  void loadPalette();
}

/** ⌘K on Apple keyboards, Ctrl+K elsewhere; by key code too, so non-Latin layouts work. */
function isPaletteShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === "k" || e.code === "KeyK");
}

/** Mounted once in the root layout: ⌘K / Ctrl+K or openPalette() opens the palette. */
export function PaletteHost() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const show = () => {
      setLoaded(true);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return;
      e.preventDefault();
      if (e.repeat) return; // a held key would flip it open and shut
      setLoaded(true);
      setOpen((o) => !o);
    };
    window.addEventListener(OPEN_EVENT, show);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, show);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return loaded ? <CommandPalette open={open} onOpenChange={setOpen} /> : null;
}
