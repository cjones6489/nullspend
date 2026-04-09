/**
 * Vitest globalSetup hook for E2E tests.
 *
 * Runs once before the test run starts. Verifies the E2E target is reachable
 * so individual tests can assume the dashboard is alive. If unreachable:
 * **fail the entire run** — both CI and local.
 *
 * # Why fail-fast instead of "skip gracefully"?
 *
 * Earlier versions of this file set `process.env.E2E_TARGET_UNREACHABLE = "1"`
 * so tests could `describe.skipIf(unreachable)`. This does NOT work with
 * vitest v4. Per the official docs:
 *
 *   "Beware that the global setup is running in a different global scope,
 *    so your tests don't have access to variables defined here. However,
 *    you can pass down serializable data to tests via `provide` method."
 *   — https://github.com/vitest-dev/vitest/blob/v4.0.7/docs/config/index.md
 *
 * With `pool: "forks"` (our default, set in vitest.e2e.config.ts), each
 * test file runs in a child_process forked from the parent. Mutations to
 * the parent's `process.env` made AFTER globalSetup runs do NOT propagate
 * to worker forks that have already been spawned. The "skip gracefully"
 * path was silently dead code — CI passed by accident (target was always
 * reachable) and local runs without a dev server would have attempted
 * requests against 127.0.0.1 with no skip.
 *
 * Fail-fast is simpler AND more honest: if the target isn't reachable,
 * the E2E framework can't do its job, so we stop the run with a clear
 * error. Developers running locally get the same message as CI. No silent
 * test omission, no false green signals.
 *
 * See tests/e2e/README.md "Environment variables" for config.
 */

import { getBaseUrl } from "./env";

export default async function setup(): Promise<() => Promise<void>> {
  const baseUrl = getBaseUrl();
  const context = process.env.CI ? "CI" : "local";
  const banner = `\n[e2e] Target: ${baseUrl} (${context})\n`;
  process.stdout.write(banner);

  // Pre-flight: hit /api/health to confirm the target is alive.
  //   200 = healthy
  //   503 = degraded but reachable (tests can still run; the
  //         health-endpoint test will surface the degraded components)
  //   anything else = fail the entire run
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `E2E target ${baseUrl}/api/health is not reachable: ${msg}\n` +
        `\n` +
        `Fix:\n` +
        `  - If running locally: start the dev server with \`pnpm dev\`\n` +
        `  - If running against a deploy: set NULLSPEND_BASE_URL to the deploy URL\n` +
        `  - If running in CI: check that the Vercel deploy completed successfully\n` +
        `    and that .github/workflows/e2e-post-deploy.yml resolved the URL correctly`,
    );
  }

  if (res.status !== 200 && res.status !== 503) {
    throw new Error(
      `E2E target ${baseUrl}/api/health returned HTTP ${res.status} ` +
        `(expected 200 or 503). Target is misconfigured or broken.`,
    );
  }

  process.stdout.write(`[e2e] Target reachable (${res.status})\n`);

  return async () => {
    // Teardown — no global state to clean up in Slice 1
  };
}
