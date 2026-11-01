import type { Metadata } from "next";
import Link from "next/link";
import { STONES } from "@/components/ui/Logo";

export const metadata: Metadata = {
  title: "Lost on the trail · cairnly",
  description: "This page isn't on any trail we know.",
};

/** A toppled cairn: the three stones scattered beside a dotted trail. */
function ToppledCairn() {
  const [bottom, middle, top] = STONES;
  return (
    <svg viewBox="0 0 240 120" width="240" height="120" aria-hidden="true" focusable="false" className="text-text">
      <path
        d="M4 104 C 60 88, 120 112, 236 96"
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth="2"
        strokeDasharray="2 8"
        strokeLinecap="round"
      />
      <g transform="translate(84 74) scale(2.4)">
        <rect {...bottom} x={0} y={0} fill="currentColor" fillOpacity="0.55" />
      </g>
      <g transform="translate(150 78) rotate(-18) scale(2.2)">
        <rect {...middle} x={0} y={0} fill="currentColor" fillOpacity="0.8" />
      </g>
      <g transform="translate(36 70) rotate(24) scale(2.2)">
        <rect {...top} x={0} y={0} fill="var(--accent)" />
      </g>
    </svg>
  );
}

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <ToppledCairn />
      <p className="eyebrow mt-8 text-faint">404</p>
      <h1 className="text-display mt-2">Lost on the trail</h1>
      <p className="mt-4 text-base text-muted">This page isn&apos;t on any trail we know.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/syllabus" className="rounded-lg border border-border bg-surface-1 px-4 py-2 text-sm text-text hover:border-border-strong">
          Back to Learn
        </Link>
        <Link href="/ask" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-strong">
          Ask cairnly
        </Link>
      </div>
    </main>
  );
}
