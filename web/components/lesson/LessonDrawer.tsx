"use client";

import { PanelLeft } from "lucide-react";
import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";

/** Below the lg breakpoint: a "Lessons" button that opens the track navigation in a drawer
 * (components/ui/Drawer: Esc, overlay or link click closes, scroll locked, focus kept inside). */
export function LessonDrawer({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="mb-4 inline-flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-1.5 text-sm text-muted hover:text-text"
      >
        <PanelLeft size={15} aria-hidden="true" />
        Lessons
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} label="Lessons">
        {children}
      </Drawer>
    </div>
  );
}
