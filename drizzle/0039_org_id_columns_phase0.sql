-- Phase 0a: Add org_id to remaining tables + fix existing text→uuid type

-- Fix existing org_id columns from text to uuid (all values are NULL, safe)
ALTER TABLE "api_keys" ALTER COLUMN "org_id" TYPE uuid USING org_id::uuid;
ALTER TABLE "budgets" ALTER COLUMN "org_id" TYPE uuid USING org_id::uuid;
ALTER TABLE "cost_events" ALTER COLUMN "org_id" TYPE uuid USING org_id::uuid;

-- Add org_id to remaining tables
ALTER TABLE "webhook_endpoints" ADD COLUMN "org_id" uuid;
ALTER TABLE "tool_costs" ADD COLUMN "org_id" uuid;
ALTER TABLE "actions" ADD COLUMN "org_id" uuid;
ALTER TABLE "slack_configs" ADD COLUMN "org_id" uuid;
ALTER TABLE "subscriptions" ADD COLUMN "org_id" uuid;
