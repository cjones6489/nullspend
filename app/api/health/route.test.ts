import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "@nullspend/db";

import { REQUIRED_SCHEMA } from "./required-schema";

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
