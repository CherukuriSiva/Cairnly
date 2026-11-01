import path from "node:path";
import type { NextConfig } from "next";

// The hourly pages (/ and /news) re-render at runtime, and so does the root layout around them
// (header track ids, footer links), all reading content/, which lies outside web/. On Vercel
// their functions must carry it, so tracing starts at the repo root. Only there: a repo-root
// trace moves standalone's server.js to standalone/web/, which the Docker image (web/Dockerfile)
// does not expect; the image copies content/ itself.
const vercelTracing: NextConfig = process.env.VERCEL
  ? {
      outputFileTracingRoot: path.join(process.cwd(), ".."),
      outputFileTracingIncludes: { "/": ["../content/**"], "/news": ["../content/**"] },
    }
  : {};

const nextConfig: NextConfig = {
  output: "standalone",
  ...vercelTracing,
  // Browsers ask for /favicon.ico on their own; serve the cairn icon (app/icon.svg) there.
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon.svg" }];
  },
};

export default nextConfig;
