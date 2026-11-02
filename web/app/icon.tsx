import { iconImage } from "@/lib/icon";

// PNG icons next to app/icon.svg: 32px for browsers without SVG favicons, 512px for the manifest.
const SIZES = [32, 512];

export const contentType = "image/png";

export function generateImageMetadata() {
  return SIZES.map((px) => ({ id: String(px), size: { width: px, height: px }, contentType }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  return iconImage(Number(await id));
}
