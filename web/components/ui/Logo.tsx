import Link from "next/link";

/** The three stones of the cairn mark, bottom to top, in a 32×32 box. Shared by the logo,
 * the favicon (app/icon.svg), the chat avatar, the 404 page and the OG images. */
export const STONES = [
  { x: 5, y: 21, width: 22, height: 8, rx: 4 },
  { x: 9, y: 14.5, width: 16, height: 7, rx: 3.5 },
  { x: 10.5, y: 8.5, width: 10, height: 6, rx: 3 },
] as const;

/** The cairn mark. The two lower stones use the current text colour, the top one the accent. */
export function CairnMark({
  size = 28,
  className,
  colors,
}: {
  size?: number;
  className?: string;
  /** Fixed colours bottom to top, for places without the CSS tokens (OG images). */
  colors?: readonly [string, string, string];
}) {
  const fills = colors ?? ["currentColor", "currentColor", "var(--accent)"];
  const opacities = colors ? [1, 1, 1] : [0.55, 0.8, 1];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {STONES.map((stone, i) => (
        <rect key={i} {...stone} fill={fills[i]} fillOpacity={opacities[i]} />
      ))}
    </svg>
  );
}

/** Mark + "cairnly" wordmark, linking home. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="cairnly home"
      className={`inline-flex shrink-0 items-center gap-2 rounded-md text-text ${className}`}
    >
      <CairnMark size={28} />
      <span className="font-display text-[22px] leading-none tracking-tight" aria-hidden="true">
        cairnly
      </span>
    </Link>
  );
}
