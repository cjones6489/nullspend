/**
 * Vitest globalSetup hook for E2E tests.
 *
 * Runs once before the test run starts. Slice 0 is a no-op placeholder so
 * the scaffold-check command passes with 0 tests.
 *
 * Subsequent slices extend this to:
 *   - Verify the target URL (NULLSPEND_BASE_URL) is reachable
 *   - Pre-flight the budget guard against the e2e-smoke-parent org
 *   - Emit a startup banner with tier + target for CI log readability
 *
 * See tests/e2e/README.md "Environment variables" for config.
 */

export default async function setup(): Promise<() => Promise<void>> {
  // Slice 0: intentionally empty. Real health checks land in Slice 1.
  // Returning a teardown function is optional in vitest's globalSetup API,
  // but we return a no-op to keep the signature forward-compatible.
  return async () => {
    // teardown — also empty in Slice 0
  };
}
