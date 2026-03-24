-- Phase 2 telemetry: estimated_cost_microdollars column
ALTER TABLE "cost_events" ADD COLUMN "estimated_cost_microdollars" bigint;
