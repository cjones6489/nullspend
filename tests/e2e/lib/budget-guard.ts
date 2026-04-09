/**
 * Pre-flight budget guard for E2E tests that hit the live proxy.
 *
 * Three layers of protection against runaway test spend:
 *   1. (here) Pre-flight check — ask the proxy what's remaining in the
 *      e2e-smoke-parent org's daily budget before running expensive tests
 *   2. Proxy-side enforcement — the e2e-smoke-parent org has a hard $5/day
 *      budget configured in the dashboard (we dogfood our own enforcement)
 *   3. Concurrency cap — vitest.e2e.config.ts maxForks: 4
 *
 * Slice 0 ships a stub that always passes. Slice 1 wires the real HTTP
 * check against GET /api/budgets/:id/status.
 */

export interface BudgetGuardOptions {
  /**
   * Minimum remaining budget (USD) required to proceed. Slices declare
   * their own ceiling — e.g. reasoning-model tests need >$1 remaining.
   */
  minRemainingUsd: number;

  /**
   * Slice name for error messages.
   */
  slice: string;
}

export class BudgetGuardError extends Error {
  constructor(
    public readonly slice: string,
    public readonly remainingUsd: number,
    public readonly requiredUsd: number,
  ) {
    super(
      `Budget guard blocked slice "${slice}": remaining $${remainingUsd.toFixed(4)} < required $${requiredUsd.toFixed(4)}. Wait for daily budget reset or increase the e2e-smoke-parent budget ceiling.`,
    );
    this.name = "BudgetGuardError";
  }
}

/**
 * Verify the e2e-smoke-parent org has enough remaining daily budget to run
 * the requested slice. Throws `BudgetGuardError` if not.
 *
 * Slice 0 stub: always passes. Real implementation lands in Slice 1 and
 * hits the dashboard's /api/budgets/:id/status endpoint.
 */
export async function assertBudgetAvailable(
  _opts: BudgetGuardOptions,
): Promise<void> {
  // Slice 0: no-op. Tests that need this helper don't exist yet.
  return;
}
