-- Add customer_id as a first-class column on cost_events.
-- Nullable: existing events have NULL, new events populate from X-NullSpend-Customer header or tags["customer"].
-- Also adds "customer" to the budgets entity_type CHECK constraint.

ALTER TABLE "cost_events" ADD COLUMN "customer_id" text;

CREATE INDEX "cost_events_customer_id_idx" ON "cost_events" ("customer_id") WHERE customer_id IS NOT NULL;

-- Update budgets CHECK constraint to allow "customer" entity type
ALTER TABLE "budgets" DROP CONSTRAINT IF EXISTS "budgets_entity_type_check";
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_entity_type_check" CHECK (entity_type IN ('user', 'agent', 'api_key', 'team', 'tag', 'customer'));
