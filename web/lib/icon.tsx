// App icons as PNGs (app/icon.tsx, app/apple-icon.tsx): the cairn mark on the dark square of
// app/icon.svg, drawn by ImageResponse at build time.

import { ImageResponse } from "next/og";
import { CairnMark } from "@/components/ui/Logo";

export const ICON_BACKGROUND = "#151311";
const PEBBLE_COLOURS = ["#f5f5f4", "#f5f5f4", "#2dd4bf"] as const;

/** A `size`-pixel square icon. `rounded` gives it the favicon's corners (8 of 32); the Apple
 * touch icon stays square because iOS rounds it itself. */
export function iconImage(size: number, { rounded = true }: { rounded?: boolean } = {}): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: ICON_BACKGROUND,
          borderRadius: rounded ? size / 4 : 0,
        }}
      >
        {/* The mark sits a little low in its box; nudge it up to centre the pebbles. */}
        <div style={{ display: "flex", marginTop: -size * 0.06 }}>
          <CairnMark size={Math.round(size * 0.74)} colors={PEBBLE_COLOURS} />
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
