/**
 * Canonical set of organization IDs that the E2E framework must never
 * delete, reset, or mutate destructively.
 *
 * **Anyone modifying this file is changing a safety-critical invariant.**
 * These IDs represent real production orgs (currently the founder's
 * Personal and Test orgs from `memory/project_founder_dogfood_upgrade.md`)
 * whose data loss would be unrecoverable.
 *
 * Single source of truth for:
 *   - `scripts/bootstrap-e2e-org.ts` — guards the rotation delete path
 *   - `tests/e2e/lib/test-org.ts` — guards future `createTestOrg` cleanup
 *   - `scripts/cleanup-orphan-test-orgs.ts` (Slice 2+) — guards the nightly
 *     orphan cleanup sweep
 *
 * # Adding a new protected org
 *
 * Add its UUID to the Set below with a comment naming the org and why it
 * needs protection. Do NOT remove existing entries unless you are
 * absolutely certain the org has been permanently deprovisioned.
 *
 * # Why this lives in `tests/e2e/lib/`
 *
 * It's only consumed by E2E tooling and a helper script (scripts/ imports
 * via relative path + tsx path alias). It does not belong in `lib/`
 * because it's not runtime production code, and it doesn't belong in
 * `packages/` because it's not a reusable package boundary — it's a
 * bespoke test-safety guard.
 */

/**
 * Frozen read-only set. Use `.has(id)` to check membership.
 *
 * @see memory/project_founder_dogfood_upgrade.md for the founder org IDs
 */
export const PROTECTED_ORG_IDS: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    // Founder Personal org (Pro dogfood tier per founder dogfood memory)
    "052f5cc2-63e6-41db-ace7-ea20364851ab",
    // Founder Test org
    "55c30156-1d15-46f7-bdb4-ca2a15a69d77",
  ]),
);

/**
 * Throws a descriptive error if the given org ID is in the protected set.
 * Use at the top of any function that performs destructive operations on
 * an org ID received from a query result or env var.
 */
export function assertNotProtected(orgId: string, context: string): void {
  if (PROTECTED_ORG_IDS.has(orgId)) {
    throw new Error(
      `SAFETY: ${context} attempted to touch protected org ${orgId}. ` +
        `This org is in the PROTECTED_ORG_IDS allowlist and must never ` +
        `be modified by E2E tooling. Check tests/e2e/lib/protected-orgs.ts.`,
    );
  }
}
