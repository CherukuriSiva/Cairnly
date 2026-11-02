import type { Metadata } from "next";
import Link from "next/link";
import { PEBBLES } from "@/components/ui/Logo";
import { pageTitle, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: pageTitle("Lost on the trail"),
  description: "This page isn't on any trail we know.",
};

// Where each pebble of the mark lands, bottom to top: its centre in the 32×32 mark, then the
// spot, tilt and scale it gets in the scene.
const SCATTER = [
  { centre: [16, 25.2], at: [114, 90], rotate: 0, scale: 3 },
  { centre: [15.9, 17], at: [190, 86], rotate: -16, scale: 2.8 },
  { centre: [16.6, 9.4], at: [48, 82], rotate: 22, scale: 2.8 },
] as const;

/** A toppled cairn: the three pebbles of the mark scattered beside a dotted trail. */
function ToppledCairn() {
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
      {PEBBLES.map((pebble, i) => {
        const { centre, at, rotate, scale } = SCATTER[i];
        return (
          <path
            key={i}
            d={pebble.d}
            transform={`translate(${at[0]} ${at[1]}) rotate(${rotate}) scale(${scale}) translate(${-centre[0]} ${-centre[1]})`}
            fill={i === PEBBLES.length - 1 ? "var(--accent)" : "currentColor"}
            fillOpacity={pebble.opacity}
          />
        );
      })}
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
          Ask {SITE_NAME}
        </Link>
      </div>
    </main>
  );
}
