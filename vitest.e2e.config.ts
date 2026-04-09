/**
 * Vitest config for E2E tests against the live stack.
 *
 * Runs files matching `tests/e2e/**\/*.e2e.test.ts`. Excludes:
 *   - `tests/e2e/browser/**` (Playwright, separate runner)
 *   - `tests/e2e/python-sdk/**` (pytest, separate runner)
 *   - `tests/e2e/chaos/**` (manual-only, no auto-discovery)
 *
 * Loads `.env.e2e` into `process.env` before tests run — mirrors the
 * `apps/proxy/vitest.smoke.config.ts` pattern so test writers don't have
 * to wire env loading manually.
 *
 * See tests/e2e/README.md for the tier model.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Load .env.e2e into process.env before tests run. Mirrors
// apps/proxy/vitest.smoke.config.ts so the pattern is consistent.
const envPath = ".env.e2e";
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.e2e.test.ts"],
    exclude: [
      "node_modules",
      "tests/e2e/browser/**",
      "tests/e2e/python-sdk/**",
      "tests/e2e/chaos/**",
    ],
    // Live-stack tests are slower than unit tests and occasionally flake.
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Parallelize by file with a fork-per-file pool so test orgs don't
    // share state. Cap concurrent files at 4 to keep proxy load reasonable.
    pool: "forks",
    fileParallelism: true,
    maxWorkers: 4,
    // Retry flaky live-stack tests in CI. Locally: no retry to surface
    // flakes fast during development.
    retry: process.env.CI ? 2 : 0,
    // JUnit output for CI artifact upload + GitHub PR check integration.
    reporters: process.env.CI
      ? [
          "default",
          ["junit", { outputFile: "test-results/e2e.junit.xml" }],
        ]
      : ["default"],
    // Shared setup: no-op in Slice 0, extended in Slice 1 with target URL
    // reachability + budget pre-flight.
    globalSetup: ["./tests/e2e/lib/global-setup.ts"],
  },
});
