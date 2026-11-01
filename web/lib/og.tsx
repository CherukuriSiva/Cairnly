// Open Graph images (1200×630): dark background with the teal glow, the cairn mark and
// "cairnly", a mono eyebrow and the page title. Uses ImageResponse's built-in font, so the
// build never fetches a font.

import { ImageResponse } from "next/og";
import { STONES } from "@/components/ui/Logo";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const STONE_COLOURS = ["#a8a29e", "#d6d3d1", "#2dd4bf"];

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
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="64" height="64" viewBox="0 0 32 32">
            {STONES.map((stone, i) => (
              <rect key={i} {...stone} fill={STONE_COLOURS[i]} />
            ))}
          </svg>
          <span style={{ fontSize: 44, letterSpacing: -1 }}>cairnly</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <span style={{ fontSize: 24, letterSpacing: 4, textTransform: "uppercase", color: "#2dd4bf" }}>{eyebrow}</span>
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
