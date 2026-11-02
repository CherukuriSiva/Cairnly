// Open Graph images (1200×630): dark background with the teal glow, the wordmark with a pebble
// dotting its "i", a mono eyebrow and the page title. Uses ImageResponse's built-in font
// (Geist), so the build never fetches a font.

import { ImageResponse } from "next/og";
import { DOT_PEBBLE } from "@/components/ui/Logo";
import { SITE_NAME } from "@/lib/site";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const TEAL = "#2dd4bf";
const WORDMARK_SIZE = 56;

/** "Cairnly" with a dotless ı under a teal pebble (components/ui/Logo.tsx PebbleWordmark). */
function Wordmark() {
  const [head, tail] = SITE_NAME.split("i");
  return (
    <div style={{ display: "flex", fontSize: WORDMARK_SIZE, lineHeight: 1, letterSpacing: -1.5 }}>
      <span>{head}</span>
      <span style={{ display: "flex", position: "relative" }}>
        {"\u0131"}
        <svg
          width={WORDMARK_SIZE * 0.26}
          height={WORDMARK_SIZE * 0.2}
          viewBox="0 0 9 7"
          style={{ position: "absolute", top: WORDMARK_SIZE * 0.02, left: -WORDMARK_SIZE * 0.035 }}
        >
          <path d={DOT_PEBBLE} fill={TEAL} />
        </svg>
      </span>
      <span>{tail}</span>
    </div>
  );
}

export function ogImage({ eyebrow, title }: { eyebrow: string; title: string }): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "radial-gradient(900px 420px at 50% -10%, rgba(45,212,191,0.28), #0c0a09)",
          backgroundColor: "#0c0a09",
          color: "#f5f5f4",
        }}
      >
        <Wordmark />
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <span style={{ fontSize: 24, letterSpacing: 4, textTransform: "uppercase", color: TEAL }}>{eyebrow}</span>
          <span
            style={{
              fontSize: 68,
              lineHeight: 1.1,
              maxWidth: 1040,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {title}
          </span>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
