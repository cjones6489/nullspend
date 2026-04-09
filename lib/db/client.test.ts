import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for lib/db/client.ts postgres.js configuration.
 *
 * Regression: P0-E — drizzle query builder 500s on Supabase Transaction pooler
 * Found by /qa on 2026-04-08 after logging in and seeing every authed dashboard
 * API route return 500 (/api/orgs, /api/keys, /api/budgets, /api/actions,
 * /api/cost-events, /api/auth/session, /api/cost-events/summary).
 * Report: .gstack/qa-reports/qa-report-nullspend-dev-2026-04-08.md
 *
 * BUG: lib/db/client.ts only set `prepare: false`. The Supabase Transaction
 * mode pooler requires ALSO setting `fetch_types: false` to skip the pg_type
 * catalog introspection that postgres.js runs on the first query. Without
 * it, parameterized queries hang because postgres.js tries to fetch type
 * OIDs over a connection that's already been returned to the pool.
 *
 * Raw SQL (db.execute(sql`SELECT 1`)) worked because it has no parameter
 * types to introspect — which is why /api/health passed but drizzle query
 * builder calls all failed. The proxy worker's apps/proxy/src/lib/db.ts had
 * the correct config; the dashboard's client.ts did not.
 *
 * Detection gap closed: these tests capture the postgres.js call arguments
 * and assert the options include the full Transaction-mode-safe set. Any
 * future refactor that drops one of these options will fail CI.
 */

// Mock postgres.js to capture the options passed to the constructor.
// Must be hoisted so the mock applies before client.ts imports it.
const { mockPostgres } = vi.hoisted(() => {
  const mockPostgres = vi.fn().mockReturnValue({
    // Minimal Sql mock — just enough to let lib/db/client.ts assign to globalThis
    end: vi.fn(),
  });
  return { mockPostgres };
});

vi.mock("postgres", () => ({
  default: mockPostgres,
}));

// Also mock drizzle so drizzle() doesn't try to do anything real with the fake Sql.
vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: vi.fn(() => ({ __mockDrizzleInstance: true })),
}));

describe("lib/db/client.ts postgres.js configuration", () => {
  beforeEach(() => {
    mockPostgres.mockClear();
    // Clear the global singleton so each test triggers a fresh postgres() call
    (globalThis as Record<string, unknown>).__nullspendSql = undefined;
    // Set required env vars so getEnv() doesn't throw
    process.env.DATABASE_URL = "postgres://localhost:5432/test";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  });

  afterEach(() => {
    vi.resetModules();
  });

  async function freshGetDb() {
    vi.resetModules();
    const mod = await import("./client");
    return mod.getDb as typeof import("./client").getDb;
  }

  describe("regression: P0-E Supabase Transaction pooler compatibility", () => {
    it("sets prepare: false (disables prepared statements)", async () => {
      const getDb = await freshGetDb();
      getDb();

      expect(mockPostgres).toHaveBeenCalledTimes(1);
      const [, options] = mockPostgres.mock.calls[0];
      expect(options).toMatchObject({ prepare: false });
    });

    it("sets fetch_types: false (skips pg_type catalog introspection)", async () => {
      const getDb = await freshGetDb();
      getDb();

      expect(mockPostgres).toHaveBeenCalledTimes(1);
      const [, options] = mockPostgres.mock.calls[0];
      // THIS IS THE REGRESSION BIT. Without this, drizzle query builder
      // calls fail in Supabase Transaction pooler mode with silent 500s.
      expect(options).toMatchObject({ fetch_types: false });
    });

    it("matches the proxy worker's Transaction-safe config", async () => {
      const getDb = await freshGetDb();
      getDb();

      const [, options] = mockPostgres.mock.calls[0];
      // These two flags are the MINIMUM required for compatibility with
      // Supabase Shared Pooler (Transaction mode, port 6543).
      // apps/proxy/src/lib/db.ts has the same requirements and documents why.
      expect(options).toEqual(
        expect.objectContaining({
          prepare: false,
          fetch_types: false,
        }),
      );
    });

    it("sets reasonable pool sizing and timeouts for serverless", async () => {
      const getDb = await freshGetDb();
      getDb();

      const [, options] = mockPostgres.mock.calls[0];
      expect(options.max).toBeGreaterThan(0);
      expect(options.max).toBeLessThanOrEqual(10); // serverless-friendly upper bound
      expect(options.idle_timeout).toBeGreaterThan(0);
      expect(options.connect_timeout).toBeGreaterThan(0);
    });

    it("kills runaway queries with a statement_timeout", async () => {
      const getDb = await freshGetDb();
      getDb();

      const [, options] = mockPostgres.mock.calls[0];
      // Prevent cost-logger / budget-lookup from blocking indefinitely
      // if a query deadlocks or the pooler stalls.
      expect(options.connection?.statement_timeout).toBeGreaterThan(0);
    });
  });

  describe("singleton behavior", () => {
    it("reuses the same postgres.js instance across getDb() calls", async () => {
      const getDb = await freshGetDb();
      getDb();
      getDb();
      getDb();

      expect(mockPostgres).toHaveBeenCalledTimes(1);
    });
  });
});
