import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "html", "lcov"],
      // Cover the tested logic (lib + API routes); UI components are exercised
      // by the app, not unit tests, so counting them would just be noise.
      include: ["lib/**/*.ts", "app/api/**/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      // A ratchet set just below current coverage: CI fails if a change drops
      // it, but passing today needs no scramble. Raise these as coverage grows.
      thresholds: {
        statements: 72,
        branches: 60,
        functions: 78,
        lines: 75,
      },
    },
  },
});
