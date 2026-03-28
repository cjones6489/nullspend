-- Fix budget uniqueness constraint: scope by org_id instead of user_id.
-- Two members of the same org should not be able to create separate
-- budgets for the same entity (api_key or user). The old constraint
-- on (user_id, entity_type, entity_id) allowed this.
DROP INDEX IF EXISTS "budgets_user_entity_idx";
CREATE UNIQUE INDEX "budgets_org_entity_idx" ON "budgets" ("org_id", "entity_type", "entity_id");
