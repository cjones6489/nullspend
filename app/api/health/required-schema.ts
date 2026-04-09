// Tables and columns that the application code requires.
// If any are missing, routes will 500 at runtime.
//
// This list MUST match the actual drizzle schema in packages/db/src/schema.ts.
// When you rename or drop a column in the schema, update this list too.
// The regression test in route.test.ts cross-checks this list against the
// drizzle schema to catch drift at CI time.
//
// History: this list rotted silently until /qa on 2026-04-08 found 4 stale
// column names that had been refactored. The drift went undetected because
// the prod DB has the new column names, only the health check's list was
// stale. See .gstack/qa-reports/qa-report-nullspend-dev-2026-04-08.md.
export const REQUIRED_SCHEMA: Array<{ table: string; columns: string[] }> = [
  // organizations: "owner" concept was renamed to "created_by" during the multi-org migration.
  { table: "organizations", columns: ["id", "name", "slug", "created_by"] },
  { table: "org_memberships", columns: ["id", "org_id", "user_id", "role"] },
  { table: "org_invitations", columns: ["id", "org_id", "email", "role"] },
  { table: "actions", columns: ["id", "org_id", "owner_user_id", "status", "agent_id", "action_type", "payload_json"] },
  { table: "api_keys", columns: ["id", "org_id", "user_id", "key_hash", "revoked_at"] },
  { table: "cost_events", columns: ["id", "org_id", "user_id", "cost_microdollars", "cost_breakdown"] },
  { table: "budgets", columns: ["id", "org_id", "entity_type", "entity_id", "max_budget_microdollars"] },
  { table: "webhook_endpoints", columns: ["id", "org_id", "user_id", "url", "signing_secret"] },
  { table: "webhook_deliveries", columns: ["id", "endpoint_id", "event_id"] },
  { table: "subscriptions", columns: ["id", "user_id", "stripe_customer_id"] },
  { table: "tool_costs", columns: ["id", "org_id", "user_id", "server_name", "tool_name"] },
  { table: "slack_configs", columns: ["id", "org_id", "user_id"] },
  // audit_events: "user_id" was renamed to "actor_id" when audit logging was formalized.
  { table: "audit_events", columns: ["id", "org_id", "actor_id", "action"] },
  { table: "stripe_connections", columns: ["id", "org_id"] },
  { table: "customer_mappings", columns: ["id", "org_id", "tag_value", "stripe_customer_id"] },
  // customer_revenue: original design stored "tag_value" and "period"; refactored during
  // the Stripe margins work to key on stripe_customer_id + period_start timestamps.
  { table: "customer_revenue", columns: ["id", "org_id", "stripe_customer_id", "period_start"] },
];
