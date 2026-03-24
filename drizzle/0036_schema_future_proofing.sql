-- Fix budget unique constraint: scope to user (prevents tag budget collisions between users)
DROP INDEX IF EXISTS "budgets_entity_type_entity_id_idx";
CREATE UNIQUE INDEX "budgets_user_entity_idx" ON "budgets" ("user_id", "entity_type", "entity_id");

-- Add org_id columns for future organization support (nullable, no default — free in Postgres)
ALTER TABLE "api_keys" ADD COLUMN "org_id" text;
ALTER TABLE "budgets" ADD COLUMN "org_id" text;
ALTER TABLE "cost_events" ADD COLUMN "org_id" text;

-- Add parent_request_id for future agent chain visualization (nullable, no default)
ALTER TABLE "cost_events" ADD COLUMN "parent_request_id" text;
