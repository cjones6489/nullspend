-- Phase 2 Increment 4: Make org_id NOT NULL + add indexes
-- Prerequisites: all rows backfilled with org_id (verified: 0 nulls across all 8 tables)
-- Orphan actions (3 rows with null owner_user_id and null org_id) deleted before this migration.

-- Step 1: Set NOT NULL on all 8 resource tables
ALTER TABLE "api_keys" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "actions" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "slack_configs" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "budgets" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "cost_events" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "subscriptions" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "tool_costs" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "webhook_endpoints" ALTER COLUMN "org_id" SET NOT NULL;

-- Step 2: Add indexes matching dashboard query patterns
-- api_keys: GET list, POST count, DELETE/PATCH by id+org
CREATE INDEX "api_keys_org_id_idx" ON "api_keys" ("org_id") WHERE "revoked_at" IS NULL;

-- budgets: GET list by org, POST existingForEntity check
CREATE INDEX "budgets_org_id_idx" ON "budgets" ("org_id");

-- cost_events: aggregation queries (daily spend, model breakdown, etc.) all filter by org_id + created_at
CREATE INDEX "cost_events_org_id_created_at_idx" ON "cost_events" ("org_id", "created_at" DESC);

-- webhook_endpoints: GET list, POST count, PATCH/DELETE by id+org
CREATE INDEX "webhook_endpoints_org_id_idx" ON "webhook_endpoints" ("org_id");

-- actions: GET list by org, getAction by id+org
CREATE INDEX "actions_org_id_idx" ON "actions" ("org_id");

-- tool_costs: GET list by org
CREATE INDEX "tool_costs_org_id_idx" ON "tool_costs" ("org_id");

-- slack_configs: GET/DELETE by org
CREATE INDEX "slack_configs_org_id_idx" ON "slack_configs" ("org_id");

-- subscriptions: not queried by org_id yet (per-user billing), skip index for now
