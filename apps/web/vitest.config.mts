import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    // src/lib/audio/virtualSignals.test.ts is an example script, not a suite.
    include: ["src/lib/stratum/**/*.test.ts"],
  },
});
