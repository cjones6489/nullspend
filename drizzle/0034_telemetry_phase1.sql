-- Phase 1 telemetry: budget_status, stop_reason columns + GIN index on tags
ALTER TABLE "cost_events" ADD COLUMN "budget_status" text;
ALTER TABLE "cost_events" ADD COLUMN "stop_reason" text;
CREATE INDEX IF NOT EXISTS "cost_events_tags_idx" ON "cost_events" USING gin ("tags");
