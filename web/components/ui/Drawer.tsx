"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** A modal side sheet. While open it locks page scroll, moves focus inside and keeps Tab
 * there; Esc, an overlay click or any link click closes it, and focus returns to whatever
 * had it before (the trigger). */
export function Drawer({
  open,
  onClose,
  label,
  side = "left",
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  side?: "left" | "right";
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // The latest onClose, so a parent's inline callback does not re-run the open effect.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      trigger?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  // Portalled to <body>: a backdrop-blurred ancestor (the header) would otherwise become the
  // containing block of this fixed layer and clip it.
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div data-testid="drawer-overlay" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`absolute inset-y-0 ${side === "left" ? "left-0 border-r" : "right-0 border-l"} flex w-72 max-w-[85vw] flex-col overflow-y-auto border-border bg-surface-1 outline-none`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) onClose();
        }}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="eyebrow text-faint">{label}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${label.toLowerCase()}`}
            className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
