import { Clock } from "lucide-react";
import { difficultyTone, tint, type Tone } from "@/components/ui/tokens";
import { formatMinutes } from "@/lib/stats";

const BASE =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-xs leading-5";

/** A small pill. `tone` tints it with a semantic colour; without one it is neutral. */
export function Badge({
  tone,
  children,
  className = "",
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  const style = tone
    ? { background: tint(tone), color: tone === "accent" ? "var(--accent)" : "var(--text)" }
    : undefined;
  return (
    <span className={`${BASE} ${tone ? "" : "border border-border bg-surface-2 text-muted"} ${className}`} style={style}>
      {children}
    </span>
  );
}

/** A coloured dot for a difficulty, used in badges, rows and lesson chips. */
export function DifficultyDot({ difficulty }: { difficulty: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: `var(--${difficultyTone(difficulty)})` }}
    />
  );
}

/** "● medium" on the difficulty's tint. */
export function DifficultyBadge({ difficulty }: { difficulty: string }) {
  return (
    <Badge tone={difficultyTone(difficulty)}>
      <DifficultyDot difficulty={difficulty} />
      {difficulty || "unrated"}
    </Badge>
  );
}

/** "⏱ 25 min" ("⏱ 1h 10m" from an hour). */
export function DurationBadge({ minutes }: { minutes: number }) {
  return (
    <Badge>
      <Clock size={12} aria-hidden="true" />
      {formatMinutes(minutes)}
    </Badge>
  );
}
