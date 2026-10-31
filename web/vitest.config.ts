import path from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests for the pure TypeScript in lib/ (no browser, no React rendering).
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
