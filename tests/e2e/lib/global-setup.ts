/**
 * Vitest globalSetup hook for E2E tests.
 *
 * Runs once before the test run starts. Verifies the E2E target is reachable
 * so individual tests can assume the dashboard is alive. If unreachable:
 *   - In CI: fail loudly with a clear error
 *   - Locally: warn + set E2E_TARGET_UNREACHABLE so tests auto-skip
 *
 * See tests/e2e/README.md "Environment variables" for config.
 */

import { getBaseUrl } from "./env";

export default async function setup(): Promise<() => Promise<void>> {
  const baseUrl = getBaseUrl();
  const banner = `\n[e2e] Target: ${baseUrl} (${process.env.CI ? "CI" : "local"})\n`;
  process.stdout.write(banner);

  // Pre-flight: hit /api/health to confirm the target is alive.
  // 200 = healthy, 503 = degraded but reachable (tests can still run and
  // the health-endpoint test will report it), anything else = fail.
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 200 && res.status !== 503) {
      throw new Error(`/api/health returned ${res.status}`);
    }
    process.stdout.write(`[e2e] Target reachable (${res.status})\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (process.env.CI) {
      throw new Error(
        `E2E target ${baseUrl}/api/health not reachable: ${msg}. ` +
          `Check NULLSPEND_BASE_URL env var and that the target deploy is healthy.`,
      );
    }
    // Local mode: skip gracefully so `pnpm e2e:run` works without a running dev server
    process.stdout.write(
      `[e2e] WARNING: target ${baseUrl} not reachable (${msg}). ` +
        `Tests that hit the dashboard will be skipped. ` +
        `Start the dev server with \`pnpm dev\` or set NULLSPEND_BASE_URL to a deployed URL.\n`,
    );
    process.env.E2E_TARGET_UNREACHABLE = "1";
  }

  return async () => {
    // Teardown — no global state to clean up in Slice 1
  };
}
