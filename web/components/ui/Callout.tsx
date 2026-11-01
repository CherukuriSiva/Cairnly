import {
  CheckCircle2,
  Compass,
  Lightbulb,
  ListChecks,
  Quote,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { tint, type Tone } from "@/components/ui/tokens";

export type CalloutVariant = "learn" | "why" | "tip" | "warning" | "interview" | "summary";

const VARIANTS: Record<CalloutVariant, { tone: Tone | null; icon: LucideIcon }> = {
  learn: { tone: "accent", icon: CheckCircle2 },
  why: { tone: null, icon: Compass }, // neutral: surface-2, no semantic colour
  tip: { tone: "info", icon: Lightbulb },
  warning: { tone: "warning", icon: TriangleAlert },
  interview: { tone: "interview", icon: Quote },
  summary: { tone: "accent-strong", icon: ListChecks },
};

/** A boxed section with a coloured left rule, a tinted background, an icon and its heading.
 * The heading keeps the `anchorId` from lib/anchors.ts so chat citations land on it. */
export function Callout({
  variant,
  title,
  anchorId,
  label,
  children,
}: {
  variant: CalloutVariant;
  title: string;
  anchorId?: string;
  /** A small chip before the heading, e.g. "Book". */
  label?: string;
  children?: React.ReactNode;
}) {
  const { tone, icon: Icon } = VARIANTS[variant];
  const colour = tone ? `var(--${tone})` : "var(--muted)";
  return (
    <section
      className={`callout callout-${variant} my-8 rounded-r-xl border-l-[3px] px-5 py-5 sm:px-6`}
      style={{ borderLeftColor: tone ? colour : "var(--border-strong)", background: tone ? tint(tone) : "var(--surface-2)" }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Icon size={16} aria-hidden="true" style={{ color: colour }} className="shrink-0" />
        {label && (
          <span className="eyebrow rounded border border-border bg-surface-1 px-1.5 py-0.5 text-[10px] text-muted">
            {label}
          </span>
        )}
        <h2 id={anchorId} className="eyebrow text-xs font-semibold" style={{ color: colour }}>
          {title}
        </h2>
      </div>
      <div className={`prose max-w-none ${variant === "interview" ? "callout-quote" : "prose-sm sm:prose-base"}`}>
        {children}
      </div>
    </section>
  );
}
