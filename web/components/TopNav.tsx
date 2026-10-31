"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Chat" },
  { href: "/syllabus", label: "Syllabus" },
  { href: "/roadmap", label: "Roadmaps" },
  { href: "/insights", label: "Insights" },
];

/** True when `pathname` belongs to the section a nav link opens. */
function isActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The sticky top bar on every page. */
export function TopNav() {
  const pathname = usePathname() ?? "/";
  return (
    <header
      className="sticky top-0 z-30 h-14 border-b"
      style={{ borderColor: "var(--line)", background: "var(--bg)" }}
    >
      <div className="mx-auto flex h-full max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="shrink-0 font-semibold">
          cairnly
        </Link>
        <nav className="ml-auto flex min-w-0 gap-4 overflow-x-auto whitespace-nowrap text-sm">
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
      </div>
    </header>
  );
}
