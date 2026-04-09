/**
 * Playwright config for browser E2E tests.
 *
 * Runs files matching `tests/e2e/browser/**\/*.spec.ts`. The tests hit a
 * live dashboard URL (local dev, Vercel preview, or production) via the
 * `NULLSPEND_BASE_URL` env var.
 *
 * Chromium only for now — Firefox/WebKit can be added later if there's
 * demand for a specific bug class.
 *
 * See tests/e2e/README.md for the tier model.
 */

import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.NULLSPEND_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e/browser",
  testMatch: "**/*.spec.ts",

  // Fail fast on unexpected state in CI; be lenient locally.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,

  // Output: HTML report for debugging, JUnit for CI artifact, GitHub
  // annotations for inline PR comments on failure.
  reporter: process.env.CI
    ? [
        ["html", { outputFolder: "playwright-report", open: "never" }],
        ["junit", { outputFile: "test-results/playwright.junit.xml" }],
        ["github"],
      ]
    : [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],

  use: {
    baseURL,
    // Retain trace on first retry so CI artifact carries repro evidence.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Reasonable defaults for a dashboard app.
    navigationTimeout: 30_000,
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
