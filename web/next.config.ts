import path from "node:path";
import type { NextConfig } from "next";

// On Vercel the News page's function must carry content/news, which lies outside web/, so
// tracing starts at the repo root. Only there: a repo-root trace moves standalone's server.js
// to standalone/web/, which the Docker image (web/Dockerfile) does not expect.
const vercelTracing: NextConfig = process.env.VERCEL
  ? {
      outputFileTracingRoot: path.join(process.cwd(), ".."),
      outputFileTracingIncludes: { "/news": ["../content/news/**"] },
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
