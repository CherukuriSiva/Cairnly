"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const OPEN_EVENT = "cairnly:open-palette";

// cmdk loads only when the palette first opens, so it is not in every page's first-load JS.
const CommandPalette = dynamic(() => import("@/components/site/CommandPalette"), { ssr: false });

/** Open the command palette from anywhere (the header's Search buttons). */
export function openPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setLoaded(true);
        setOpen((o) => !o);
      }
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
