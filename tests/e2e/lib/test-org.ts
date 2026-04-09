/**
 * Seed-on-demand test org creation + symmetric cleanup.
 *
 * Every E2E test file creates its own isolated org via `createTestOrg()`
 * in `beforeAll`, and destroys it via `cleanup()` in `afterAll`. Orgs are
 * prefixed `e2e-` with a timestamp + UUID suffix so concurrent runs never
 * collide.
 *
 * Slice 0 ships the types + a stub that throws "not implemented" so any
 * test that imports it fails loudly rather than silently running against
 * shared state. Slice 1 wires the real Supabase admin + Postgres cleanup.
 *
 * See tests/e2e/README.md "Test isolation" for the lifecycle.
 */

/**
 * A provisioned test org ready for use by an E2E test.
 *
 * Always call `cleanup()` in `afterAll`, even if the test crashes. The
 * cleanup sweep (`scripts/cleanup-orphan-test-orgs.ts`) catches orphans
 * nightly, but symmetric cleanup is still required to keep the test DB
 * small and avoid concurrent-run collisions.
 */
export interface TestOrg {
  /** Unique org ID (UUID). */
  orgId: string;
  /** Supabase auth user ID (UUID). */
  userId: string;
  /** Plaintext API key for authenticated dashboard calls. Ephemeral — never logged. */
  apiKey: string;
  /** Dev actor header value for session-auth bypass. */
  devActor: string;
  /** Symmetric cleanup — deletes everything created by this test org. */
  cleanup: () => Promise<void>;
}

/**
 * Protected org IDs that the cleanup sweep will refuse to touch.
 *
 * Re-exported from `./protected-orgs` so callers can import from either
 * path during the Slice 1e→1g transition. New code should import directly
 * from `./protected-orgs`.
 */
export { PROTECTED_ORG_IDS, assertNotProtected } from "./protected-orgs";

export interface CreateTestOrgOptions {
  /**
   * Optional suffix for the org name. Auto-generated from timestamp + UUID
   * if not provided. Must match `/^e2e-[a-z0-9-]+$/` for the cleanup sweep
   * to recognize it as an E2E orphan.
   */
  suffix?: string;
}

/**
 * Provision an isolated test org. Stub in Slice 0 — throws on use.
 *
 * Slice 1 real implementation will:
 *   - Create a Supabase auth user (email: `e2e-<suffix>@nullspend-test.invalid`)
 *   - Mark the user as email-confirmed via service-role key (skips verification email)
 *   - Create an organization row with prefix `e2e-<suffix>`
 *   - Create a membership with role=owner
 *   - Create an api_key row + return the plaintext
 *   - Return a `cleanup()` closure that deletes everything in dependency order
 */
export async function createTestOrg(
  _opts: CreateTestOrgOptions = {},
): Promise<TestOrg> {
  throw new Error(
    "createTestOrg is not implemented in Slice 0. Wiring lands in Slice 1 (infra smoke).",
  );
}
