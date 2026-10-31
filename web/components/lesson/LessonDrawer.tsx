"use client";

import { useEffect, useRef, useState } from "react";

/** Below the lg breakpoint: a "Lessons" button that opens the track navigation in a drawer.
 * It closes on Esc, an overlay click or any link click, locks page scroll while open, and moves
 * focus into the panel. */
export function LessonDrawer({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className="mb-4 rounded-md border px-3 py-1.5 text-sm"
        style={{ borderColor: "var(--line)" }}
      >
        Lessons
      </button>
      {open && (
        <div className="fixed inset-0 z-40">
          <div
            data-testid="drawer-overlay"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Lessons"
            className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto outline-none"
            style={{ background: "var(--panel)" }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) setOpen(false);
            }}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
