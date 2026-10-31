"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const LINKS = [
  { href: "/", label: "Chat" },
  { href: "/syllabus", label: "Syllabus" },
  { href: "/roadmap", label: "Roadmaps" },
  { href: "/insights", label: "Insights" },
  { href: "/news", label: "News" },
];

/** True when `pathname` belongs to the section a nav link opens. */
function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The sticky top bar on every page. From 400px wide the links sit in a row; on narrower
 * phones they move into a small dropdown so none of them is cut off. */
export function TopNav() {
  const pathname = usePathname() ?? "/";
  const current = LINKS.find((link) => isActive(link.href, pathname));
  return (
    <header
      className="sticky top-0 z-30 h-14 border-b"
      style={{ borderColor: "var(--line)", background: "var(--bg)" }}
    >
      <div className="mx-auto flex h-full max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="shrink-0 font-semibold">
          cairnly
        </Link>
        <nav className="ml-auto hidden gap-3 whitespace-nowrap text-sm min-[400px]:flex sm:gap-4">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{ color: isActive(link.href, pathname) ? "var(--accent)" : "var(--muted)" }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <MobileMenu pathname={pathname} label={current?.label ?? "Menu"} />
      </div>
    </header>
  );
}

/** Below 400px: a button showing the current section that opens the list of links.
 * Closes on a link click, Escape, or a click outside. */
function MobileMenu({ pathname, label }: { pathname: string; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={box} className="relative ml-auto min-[400px]:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm"
      >
        {label} <span aria-hidden>▾</span>
      </button>
      {open && (
        <nav
          aria-label="Sections"
          className="absolute right-0 mt-2 w-44 rounded-lg border border-[var(--line)] bg-[var(--panel)] py-1 shadow-lg"
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              aria-current={isActive(link.href, pathname) ? "page" : undefined}
              className="block px-4 py-2 text-sm"
              style={{ color: isActive(link.href, pathname) ? "var(--accent)" : "var(--ink)" }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
