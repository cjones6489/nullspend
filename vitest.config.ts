import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Exclude E2E live-stack test files (run via `pnpm e2e:run` +
    // vitest.e2e.config.ts), Playwright specs (run via `pnpm e2e:browser`),
    // Python tests, and manual chaos tests. Unit tests that live in
    // `tests/e2e/lib/` (for the E2E helper modules) DO run here — they
    // mock all external deps and are fast, so they belong alongside
    // the rest of the unit suite.
    exclude: [
      "node_modules",
      "packages/**",
      "apps/**",
      ".next/**",
      "tests/e2e/**/*.e2e.test.ts",
      "tests/e2e/browser/**",
      "tests/e2e/python-sdk/**",
      "tests/e2e/chaos/**",
    ],
  },
});
