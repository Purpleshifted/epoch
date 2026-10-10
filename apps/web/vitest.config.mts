import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    // src/lib/audio/virtualSignals.test.ts is an example script, not a suite.
    include: ["src/lib/stratum/**/*.test.ts", "src/lib/sprites/**/*.test.ts", "src/lib/parliament/**/*.test.ts"],
    // the world-building suites take seconds each; with all files in parallel on a busy machine 5 s is not enough
    testTimeout: 60_000,
  },
});
