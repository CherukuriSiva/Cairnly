import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";

export const alt = "cairnly: Find your way into AI engineering";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({ eyebrow: "AI engineering, one stone at a time", title: "Find your way into AI engineering" });
}
