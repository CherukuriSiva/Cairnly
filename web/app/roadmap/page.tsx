import type { Metadata } from "next";
import Link from "next/link";
import { getRoadmaps } from "@/lib/content";

export const metadata: Metadata = { title: "Roadmaps · cairnly" };

export default function RoadmapsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="text-3xl font-bold tracking-tight">Roadmaps</h1>
      <p className="mt-3" style={{ color: "var(--muted)" }}>
        Step-by-step plans for different starting points and amounts of time.
      </p>
      <ul className="mt-8 space-y-4">
        {getRoadmaps().map((roadmap) => (
          <li key={roadmap.slug}>
            <Link
              href={`/roadmap/${roadmap.slug}`}
              className="block rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 hover:border-[var(--accent)]"
            >
              <span className="font-mono text-xs uppercase tracking-widest text-[var(--muted)]">
                {roadmap.timeHorizon}
              </span>
              <span className="mt-1 block font-semibold">{roadmap.title}</span>
              <span className="mt-1 block text-sm text-[var(--muted)]">{roadmap.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
