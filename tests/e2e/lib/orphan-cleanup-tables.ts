/**
 * Single source of truth for which tables the bootstrap script must
 * explicitly delete from to prevent orphan rows when an org is reset.
 *
 * # The bug class this prevents
 *
 * When `scripts/bootstrap-e2e-org.ts` deletes the bootstrap organization
 * to rotate credentials, Postgres CASCADE rules automatically clean up
 * any FK-linked rows. But MANY tables in the NullSpend schema have an
 * `org_id` column WITHOUT an FK constraint — historical design decision,
 * possibly intentional for decoupling, possibly accidental. Those rows
 * become orphans pointing at a dead org_id.
 *
 * This list enumerates the NON-FK tables that require explicit
 * `DELETE FROM t WHERE org_id = $1` inside the bootstrap transaction.
 *
 * # Drift detection
 *
 * `tests/e2e/lib/orphan-cleanup-tables.test.ts` walks every pgTable
 * exported from `@nullspend/db` at test time, reads its column and
 * foreign-key metadata via drizzle's `getTableConfig()`, and asserts:
 *
 *   1. Every table with an `org_id` column AND no FK-with-CASCADE to
 *      `organizations` MUST appear in `ORG_ID_CLEANUP_TABLES` below.
 *   2. Every entry in `ORG_ID_CLEANUP_TABLES` must actually have an
 *      `org_id` column (catches stale imports after schema refactors).
 *
 * When a new `org_id`-scoped table is added to the schema without a
 * CASCADE FK, the test fails with a clear message telling the developer
 * to add the table here. The fail prevents the class of silent orphan
 * accumulation that would otherwise only surface via periodic DB audits.
 *
 * # How bootstrap uses this
 *
 * `scripts/bootstrap-e2e-org.ts` has explicit `tx.delete(...)` calls
 * for each table rather than iterating this constant at runtime. That's
 * because drizzle's typed query builder needs each `eq(table.orgId, ...)`
 * call to narrow the specific table type, and iterating loses the
 * narrowing. The explicit calls are verified by the drift test to
 * cover every table listed here.
 */

import {
  actions,
  apiKeys,
  auditEvents,
  budgets,
  costEvents,
  sessions,
  slackConfigs,
  subscriptions,
  toolCosts,
  webhookEndpoints,
} from "@nullspend/db";

/**
 * Tables the bootstrap script must explicitly delete from. Every entry
 * must have an `orgId` column (verified by `orphan-cleanup-tables.test.ts`).
 *
 * NOTE: Do not add FK-CASCADE tables here — Postgres handles those
 * automatically. Adding a CASCADE table produces a harmless duplicate
 * delete, not a bug.
 *
 * When adding a new `org_id` table to `packages/db/src/schema.ts`:
 *   1. If the table has `references(() => organizations.id, { onDelete: "cascade" })`
 *      → DO NOTHING here. CASCADE handles cleanup.
 *   2. If the table has NO FK to organizations → add it to this array
 *      AND add an explicit `tx.delete(...)` call in
 *      `scripts/bootstrap-e2e-org.ts` for the typed drizzle delete.
 */
export const ORG_ID_CLEANUP_TABLES = [
  actions,
  apiKeys,
  auditEvents,
  budgets,
  costEvents,
  sessions,
  slackConfigs,
  subscriptions,
  toolCosts,
  webhookEndpoints,
] as const;

/**
 * Snake-case table names, pre-computed for comparison against
 * `getTableConfig().name` results. Used by the drift test.
 */
export const ORG_ID_CLEANUP_TABLE_NAMES: ReadonlySet<string> = new Set([
  "actions",
  "api_keys",
  "audit_events",
  "budgets",
  "cost_events",
  "reconciled_requests",
  "sessions",
  "slack_configs",
  "subscriptions",
  "tool_costs",
  "webhook_endpoints",
]);
