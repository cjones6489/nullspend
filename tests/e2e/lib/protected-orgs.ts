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
 * Read-only set of founder org IDs that E2E tooling must never touch.
 *
 * # Runtime vs. compile-time immutability
 *
 * This constant is typed as `ReadonlySet<string>`, which prevents
 * TypeScript callers from calling `.add()`, `.delete()`, or `.clear()`
 * at compile time. It is NOT frozen at runtime — `Object.freeze()` on
 * a `Set` is a no-op because Set mutations happen via internal slots,
 * not own properties. A caller who does
 *   `(PROTECTED_ORG_IDS as Set<string>).add(...)`
 * will succeed at runtime, but the type cast makes the intent obvious
 * and requires an explicit bypass of the safety guarantee.
 *
 * Type-level immutability is sufficient for internal tooling because
 * every caller is trusted code in this same repo. If we ever needed
 * runtime enforcement (e.g., if this constant were exposed to
 * untrusted code), we'd wrap it in a `Proxy` that throws on mutation.
 *
 * @see memory/project_founder_dogfood_upgrade.md for the founder org IDs
 */
export const PROTECTED_ORG_IDS: ReadonlySet<string> = new Set<string>([
  // Founder Personal org (Pro dogfood tier per founder dogfood memory)
  "052f5cc2-63e6-41db-ace7-ea20364851ab",
  // Founder Test org
  "55c30156-1d15-46f7-bdb4-ca2a15a69d77",
]);

/**
 * Thrown by `assertNotProtected` when a caller attempts a destructive
 * operation on a protected org. Distinct error class so callers that
 * catch errors can identify and re-raise safety violations specifically.
 */
export class ProtectedOrgError extends Error {
  constructor(
    public readonly orgId: string,
    public readonly context: string,
  ) {
    super(
      `SAFETY: ${context} attempted to touch protected org ${orgId}. ` +
        `This org is in the PROTECTED_ORG_IDS allowlist and must never ` +
        `be modified by E2E tooling. Check tests/e2e/lib/protected-orgs.ts.`,
    );
    this.name = "ProtectedOrgError";
  }
}

/**
 * Normalize an org ID string for protection-set comparison.
 *
 * Drizzle's postgres.js client returns UUIDs in their canonical form
 * (lowercase hex, standard hyphen positions), but the safety check is
 * designed to be the LAST line of defense — a caller that passes an
 * uppercase or whitespace-padded ID should still be caught.
 *
 * This normalization is deliberately conservative:
 *   1. trim() — remove leading/trailing whitespace (handles env var
 *      values that got a trailing newline from a shell pipe)
 *   2. toLowerCase() — handle mixed-case UUIDs (e.g., from JWT claims
 *      or third-party APIs that return uppercase)
 *
 * If the normalized value ever matches a PROTECTED_ORG_IDS entry,
 * `assertNotProtected` throws — even if the raw input was uppercase
 * or padded.
 */
function normalizeOrgId(orgId: string): string {
  return orgId.trim().toLowerCase();
}

/**
 * Throws a `ProtectedOrgError` if the given org ID is in the protected
 * set. Use at the top of any function that performs destructive
 * operations on an org ID received from a query result, env var, JWT
 * claim, or external API.
 *
 * Inputs are normalized (trim + lowercase) before comparison, so
 * `"052F5CC2-..."`, `" 052f5cc2-... "`, and `"052f5cc2-..."` all
 * match the same protected entry. Original (raw) input is preserved
 * in the thrown error's `orgId` field for debugging.
 */
export function assertNotProtected(orgId: string, context: string): void {
  const normalized = normalizeOrgId(orgId);
  if (PROTECTED_ORG_IDS.has(normalized)) {
    throw new ProtectedOrgError(orgId, context);
  }
}
