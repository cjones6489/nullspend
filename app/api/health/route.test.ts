import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "@nullspend/db";

import { REQUIRED_SCHEMA } from "./required-schema";
import { _verboseAllowedForTesting as verboseAllowed } from "./route";

/**
 * This test cross-checks the health endpoint's REQUIRED_SCHEMA list
 * against the actual drizzle schema in packages/db. Any drift (rename,
 * drop, typo) causes a test failure at CI time instead of a silent
 * "degraded" report in production.
 *
 * Regression: P0-D — health check REQUIRED_SCHEMA rotted silently
 * Found by /qa on 2026-04-08
 * Report: .gstack/qa-reports/qa-report-nullspend-dev-2026-04-08.md
 *
 * The original bug: organizations.owner_user_id had been renamed to
 * created_by, audit_events.user_id to actor_id, and customer_revenue
 * had been refactored entirely. The health check's hardcoded list
 * never caught up. The prod DB was fine; the health check was lying.
 *
 * Detection gap closed: this test asserts every (table, column) pair
 * in REQUIRED_SCHEMA exists in the drizzle schema. If a future refactor
 * renames or drops a column, CI catches it before production.
 */
describe("app/api/health REQUIRED_SCHEMA drizzle cross-check", () => {
  // Build a map of { tableName -> Set<columnName> } from the drizzle schema.
  const drizzleColumns = new Map<string, Set<string>>();

  for (const value of Object.values(schema)) {
    // Drizzle tables are pg objects that getTableConfig can introspect.
    // Non-table exports (types, helpers) will throw — skip those.
    try {
      const config = getTableConfig(value as never);
      const cols = new Set(config.columns.map((c) => c.name));
      drizzleColumns.set(config.name, cols);
    } catch {
      // Not a drizzle table export — skip.
    }
  }

  it("found at least one drizzle table (sanity check)", () => {
    expect(drizzleColumns.size).toBeGreaterThan(5);
  });

  for (const { table, columns } of REQUIRED_SCHEMA) {
    describe(`table ${table}`, () => {
      it("exists in the drizzle schema", () => {
        expect(
          drizzleColumns.has(table),
          `REQUIRED_SCHEMA references table "${table}" which does not exist in packages/db/src/schema.ts. Either the table was renamed or REQUIRED_SCHEMA is stale.`,
        ).toBe(true);
      });

      for (const col of columns) {
        it(`has column "${col}"`, () => {
          const cols = drizzleColumns.get(table);
          if (!cols) return; // parent "exists" test already failed
          expect(
            cols.has(col),
            `REQUIRED_SCHEMA expects column "${table}.${col}" but the drizzle schema has: ${[...cols].join(", ")}`,
          ).toBe(true);
        });
      }
    });
  }
});

describe("verbose mode opt-in gate (Drift-3 / G-18)", () => {
  const savedSecret = process.env.INTERNAL_HEALTH_SECRET;

  beforeEach(() => {
    delete process.env.INTERNAL_HEALTH_SECRET;
  });

  afterEach(() => {
    if (savedSecret !== undefined) {
      process.env.INTERNAL_HEALTH_SECRET = savedSecret;
    } else {
      delete process.env.INTERNAL_HEALTH_SECRET;
    }
  });

  const makeRequest = (headers?: Record<string, string>) =>
    new Request("http://localhost/api/health?verbose=1", {
      method: "GET",
      headers,
    });

  it("allows verbose when no server secret is set (opt-in disabled)", () => {
    expect(verboseAllowed(makeRequest())).toBe(true);
  });

  it("allows verbose when server secret is an empty string (disabled)", () => {
    process.env.INTERNAL_HEALTH_SECRET = "";
    expect(verboseAllowed(makeRequest())).toBe(true);
  });

  it("allows verbose when server secret is whitespace-only (disabled)", () => {
    process.env.INTERNAL_HEALTH_SECRET = "   ";
    expect(verboseAllowed(makeRequest())).toBe(true);
  });

  it("DENIES verbose when server secret is set and no client header", () => {
    process.env.INTERNAL_HEALTH_SECRET = "sekret-abc-123";
    expect(verboseAllowed(makeRequest())).toBe(false);
  });

  it("DENIES verbose when server secret is set and client header is wrong", () => {
    process.env.INTERNAL_HEALTH_SECRET = "sekret-abc-123";
    expect(
      verboseAllowed(
        makeRequest({ "x-ops-health-secret": "different-secret" }),
      ),
    ).toBe(false);
  });

  it("DENIES verbose when server secret is set and header is empty string", () => {
    process.env.INTERNAL_HEALTH_SECRET = "sekret-abc-123";
    expect(
      verboseAllowed(makeRequest({ "x-ops-health-secret": "" })),
    ).toBe(false);
  });

  it("ALLOWS verbose when client header exactly matches server secret", () => {
    process.env.INTERNAL_HEALTH_SECRET = "sekret-abc-123";
    expect(
      verboseAllowed(
        makeRequest({ "x-ops-health-secret": "sekret-abc-123" }),
      ),
    ).toBe(true);
  });

  it("DENIES verbose on length-mismatch (pre-empts timingSafeEqual throw)", () => {
    process.env.INTERNAL_HEALTH_SECRET = "short";
    expect(
      verboseAllowed(
        makeRequest({
          "x-ops-health-secret": "much-longer-than-the-server-value",
        }),
      ),
    ).toBe(false);
  });

  it("DENIES verbose on multi-byte character length mismatch (Buffer byte length, not String length)", () => {
    // "café" is 5 JS chars but 6 UTF-8 bytes (é = 2 bytes).
    // "cafes" is 5 JS chars and 5 UTF-8 bytes.
    // String.length would say equal (both 5); Buffer.from().length differs (6 vs 5).
    // The fix uses Buffer-based comparison to prevent timing leaks.
    process.env.INTERNAL_HEALTH_SECRET = "café!";
    expect(
      verboseAllowed(
        makeRequest({ "x-ops-health-secret": "cafes" }),
      ),
    ).toBe(false);
  });

  it("ALLOWS verbose with multi-byte characters when they match exactly", () => {
    process.env.INTERNAL_HEALTH_SECRET = "café!";
    expect(
      verboseAllowed(
        makeRequest({ "x-ops-health-secret": "café!" }),
      ),
    ).toBe(true);
  });

  it("uses timing-safe comparison (same length, different content)", () => {
    // Two strings of the same length but with different content.
    // This exercises timingSafeEqual directly — if we used ===, the
    // comparison would short-circuit on the first byte difference
    // and leak timing information about the secret.
    process.env.INTERNAL_HEALTH_SECRET = "aaaaaaaaaaaaaaaa";
    expect(
      verboseAllowed(
        makeRequest({ "x-ops-health-secret": "bbbbbbbbbbbbbbbb" }),
      ),
    ).toBe(false);
    expect(
      verboseAllowed(
        makeRequest({ "x-ops-health-secret": "aaaaaaaaaaaaaaaa" }),
      ),
    ).toBe(true);
  });
});
