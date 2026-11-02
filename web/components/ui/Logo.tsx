import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

/** The three pebbles of the cairn mark, bottom to top, as paths in a 32×32 box, with the
 * opacity of each. Shared by the logo, the icons (lib/icon.tsx), the chat avatar, the 404
 * page and the OG images. */
export const PEBBLES = [
  { d: "M3.5 25.6c0-2.7 4.6-4.5 11.3-4.6 7.6-.1 13.7 1.5 13.7 4.4 0 2.6-5.3 3.9-12.4 3.9-7.3 0-12.6-1.2-12.6-3.7z", opacity: 0.5 },
  { d: "M7.6 17.3c.2-2.4 3.7-3.8 8.3-3.7 4.5.1 8.4 1.3 8.2 3.7-.2 2.2-3.8 3.2-8.3 3.1-4.6-.1-8.4-1-8.2-3.1z", opacity: 0.8 },
  { d: "M11.9 9.6c.1-2 2.3-3.4 4.9-3.3 2.7.1 4.6 1.4 4.5 3.3-.1 1.9-2.2 2.9-4.9 2.8-2.7-.1-4.6-1-4.5-2.8z", opacity: 1 },
] as const;

/** The small pebble that dots the "i" of the large wordmark, in a 9×7 box. */
export const DOT_PEBBLE = "M.3 3.6C.4 1.6 2.3.3 4.7.4 7 .5 8.8 1.7 8.7 3.6 8.6 5.4 6.7 6.5 4.3 6.4 1.9 6.3.2 5.4.3 3.6z";

/** The cairn mark: two pebbles in the current text colour, the top one in the accent. */
export function CairnMark({
  size = 28,
  className,
  colors,
}: {
  size?: number;
  className?: string;
  /** Fixed colours bottom to top, for places without the CSS tokens (icons, OG images). */
  colors?: readonly [string, string, string];
}) {
  const fills = colors ?? ["currentColor", "currentColor", "var(--accent)"];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false" className={className}>
      {PEBBLES.map((pebble, i) => (
        <path key={i} d={pebble.d} fill={fills[i]} fillOpacity={pebble.opacity} />
      ))}
    </svg>
  );
}

/** The logo, linking home: the mark alone, or the mark and the "Cairnly" wordmark. `size` is
 * the mark's size; the wordmark scales with it (20px beside a 28px mark). */
export function Logo({
  variant = "full",
  size = 28,
  className = "",
}: {
  variant?: "mark" | "full";
  size?: number;
  className?: string;
}) {
  return (
    <Link
      href="/"
      aria-label={`${SITE_NAME} home`}
      className={`inline-flex shrink-0 items-center gap-2.5 rounded-md text-text ${className}`}
    >
      <CairnMark size={size} />
      {variant === "full" && (
        <span
          aria-hidden="true"
          className="font-semibold leading-none tracking-[-0.03em]"
          style={{ fontSize: Math.round((size * 5) / 7) }}
        >
          {SITE_NAME}
        </span>
      )}
    </Link>
  );
}

/** The large wordmark for the home hero: "Cairnly" with a teal pebble for the dot of the "i"
 * (a dotless ı under an absolutely placed pebble). Screen readers read the label. */
export function PebbleWordmark({ className = "" }: { className?: string }) {
  return (
    <span role="img" aria-label={SITE_NAME} className={`inline-flex pt-[0.1em] font-semibold leading-none tracking-[-0.03em] ${className}`}>
      <span aria-hidden="true">Ca</span>
      <span aria-hidden="true" className="relative">
        {"\u0131"}
        <svg
          viewBox="0 0 9 7"
          aria-hidden="true"
          focusable="false"
          className="absolute left-1/2 top-[0.04em] h-[0.19em] w-[0.245em] -translate-x-1/2 fill-accent"
        >
          <path d={DOT_PEBBLE} />
        </svg>
      </span>
      <span aria-hidden="true">rnly</span>
    </span>
  );
}
