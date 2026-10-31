import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Browsers ask for /favicon.ico on their own; serve the cairn icon (app/icon.svg) there.
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon.svg" }];
  },
};

export default nextConfig;
