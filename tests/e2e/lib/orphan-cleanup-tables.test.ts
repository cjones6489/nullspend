/**
 * Schema drift test for the bootstrap orphan cleanup list.
 *
 * Walks every `pgTable` exported from `@nullspend/db` and asserts:
 *
 *   1. Every table with an `org_id` column AND no FK-with-CASCADE to
 *      `organizations` is in `ORG_ID_CLEANUP_TABLE_NAMES`.
 *   2. Every entry in `ORG_ID_CLEANUP_TABLE_NAMES` actually exists
 *      in the schema (catches stale entries after table renames).
 *   3. No FK-CASCADE table is listed (those would be harmless
 *      duplicates but suggest someone misunderstood the classification).
 *
 * # Why this exists
 *
 * The Slice 1e/1f audit flagged that the bootstrap script's orphan
 * cleanup list is hand-maintained. A future schema change that adds
 * a new `org_id`-scoped table without a CASCADE FK would silently
 * accumulate orphan rows every time the bootstrap org rotates.
 *
 * Without this test, the drift is invisible until someone manually
 * queries `information_schema` in production. This test catches it
 * at unit-test time, with a clear message naming the missing table.
 *
 * # Implementation note
 *
 * We use drizzle's `getTableConfig()` helper (verified present in
 * drizzle-orm@0.45.2 at
 * node_modules/.../drizzle-orm/pg-core/utils.d.ts) to read column
 * and FK metadata. `is(value, PgTable)` is drizzle's runtime check
 * for identifying pgTable instances at module-walk time.
 */

import { describe, it, expect } from "vitest";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "@nullspend/db";

import { ORG_ID_CLEANUP_TABLE_NAMES } from "./orphan-cleanup-tables";

// The canonical name of the table the FK points at. If the organizations
// table is ever renamed, this must be updated.
const ORGANIZATIONS_TABLE_NAME = "organizations";

// Walk every export of @nullspend/db and keep the ones that are pgTables.
// `is(value, PgTable)` is drizzle's runtime identity check — it handles
// both class instances and subclass instances correctly.
const ALL_PG_TABLES: Array<{ name: string; table: PgTable }> = [];
for (const [exportName, value] of Object.entries(schema)) {
  if (is(value, PgTable)) {
    const config = getTableConfig(value);
    ALL_PG_TABLES.push({ name: config.name, table: value });
    // Prevent unused var warning
    void exportName;
  }
}

/**
 * For each pgTable in the schema, compute whether it has an `org_id`
 * column and whether it has a FOREIGN KEY to organizations with
 * ON DELETE CASCADE. Both facts are needed to classify the table.
 */
interface TableOrgClassification {
  name: string;
  hasOrgId: boolean;
  hasCascadeFkToOrgs: boolean;
}

const CLASSIFICATIONS: TableOrgClassification[] = ALL_PG_TABLES.map(
  ({ name, table }) => {
    const config = getTableConfig(table);
    const hasOrgId = config.columns.some((col) => col.name === "org_id");

    // Walk FKs — each FK has a reference() function that returns
    // { columns, foreignColumns, onDelete, ... } when invoked.
    const hasCascadeFkToOrgs = config.foreignKeys.some((fk) => {
      const ref = fk.reference();
      // The target table is the table owning the foreign columns.
      const targetTableName = ref.foreignTable
        ? getTableConfig(ref.foreignTable).name
        : undefined;
      if (targetTableName !== ORGANIZATIONS_TABLE_NAME) return false;
      // onDelete is "cascade" | "restrict" | "set null" | "set default" | "no action"
      return fk.onDelete === "cascade";
    });

    return { name, hasOrgId, hasCascadeFkToOrgs };
  },
);

describe("Bootstrap orphan cleanup drift (EC-3 regression)", () => {
  it("schema export walk finds a reasonable number of pgTables", () => {
    // Sanity check: if this drops unexpectedly, drizzle's PgTable
    // runtime check broke or the schema refactored drastically.
    expect(ALL_PG_TABLES.length).toBeGreaterThan(10);
  });

  it("every org_id table without a CASCADE FK MUST be in ORG_ID_CLEANUP_TABLE_NAMES", () => {
    const nonCascadeOrgIdTables = CLASSIFICATIONS.filter(
      (c) => c.hasOrgId && !c.hasCascadeFkToOrgs,
    ).map((c) => c.name);

    const missing = nonCascadeOrgIdTables.filter(
      (name) => !ORG_ID_CLEANUP_TABLE_NAMES.has(name),
    );

    expect(
      missing,
      `The following tables have an org_id column with no CASCADE FK ` +
        `to organizations, and would leave orphan rows on bootstrap rotation:\n` +
        `  ${missing.join("\n  ")}\n\n` +
        `Fix:\n` +
        `  1. Add these tables to ORG_ID_CLEANUP_TABLE_NAMES in\n` +
        `     tests/e2e/lib/orphan-cleanup-tables.ts\n` +
        `  2. Add a matching \`tx.delete(tableName).where(eq(tableName.orgId, ...))\`\n` +
        `     call in scripts/bootstrap-e2e-org.ts\n` +
        `  OR:\n` +
        `     Add \`.references(() => organizations.id, { onDelete: "cascade" })\`\n` +
        `     to the column definition in packages/db/src/schema.ts and let\n` +
        `     Postgres CASCADE handle cleanup.`,
    ).toEqual([]);
  });

  it("every entry in ORG_ID_CLEANUP_TABLE_NAMES must exist in the schema", () => {
    const allSchemaTableNames = new Set(ALL_PG_TABLES.map((t) => t.name));
    const stale = [...ORG_ID_CLEANUP_TABLE_NAMES].filter(
      (name) => !allSchemaTableNames.has(name),
    );
    expect(
      stale,
      `The following table names are in ORG_ID_CLEANUP_TABLE_NAMES but ` +
        `no longer exist in the drizzle schema (renamed or removed?):\n` +
        `  ${stale.join("\n  ")}\n\n` +
        `Remove them from tests/e2e/lib/orphan-cleanup-tables.ts and update ` +
        `scripts/bootstrap-e2e-org.ts to match.`,
    ).toEqual([]);
  });

  it("every entry in ORG_ID_CLEANUP_TABLE_NAMES must actually have an org_id column", () => {
    const byName = new Map(ALL_PG_TABLES.map((t) => [t.name, t.table]));
    const withoutOrgId: string[] = [];
    for (const tableName of ORG_ID_CLEANUP_TABLE_NAMES) {
      const table = byName.get(tableName);
      if (!table) continue; // already caught by the previous test
      const config = getTableConfig(table);
      if (!config.columns.some((c) => c.name === "org_id")) {
        withoutOrgId.push(tableName);
      }
    }
    expect(
      withoutOrgId,
      `The following tables are in ORG_ID_CLEANUP_TABLE_NAMES but do not ` +
        `have an org_id column:\n  ${withoutOrgId.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no FK-CASCADE table should be listed (CASCADE handles cleanup)", () => {
    // Listing a CASCADE table is harmless (duplicate delete), but
    // suggests the maintainer misunderstood the classification — the
    // explicit delete isn't needed because Postgres already handles it.
    const redundant = CLASSIFICATIONS.filter(
      (c) => c.hasCascadeFkToOrgs && ORG_ID_CLEANUP_TABLE_NAMES.has(c.name),
    ).map((c) => c.name);

    expect(
      redundant,
      `The following tables are in ORG_ID_CLEANUP_TABLE_NAMES but ALSO ` +
        `have a CASCADE FK to organizations. The explicit delete is ` +
        `redundant — Postgres already handles these on org deletion:\n` +
        `  ${redundant.join("\n  ")}`,
    ).toEqual([]);
  });
});
