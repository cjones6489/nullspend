-- M9: Non-negative CHECK constraints on token columns
ALTER TABLE "cost_events"
  ADD CONSTRAINT "cost_events_input_tokens_nonneg"
  CHECK (input_tokens >= 0);
--> statement-breakpoint
ALTER TABLE "cost_events"
  ADD CONSTRAINT "cost_events_output_tokens_nonneg"
  CHECK (output_tokens >= 0);
--> statement-breakpoint
ALTER TABLE "cost_events"
  ADD CONSTRAINT "cost_events_cached_input_tokens_nonneg"
  CHECK (cached_input_tokens >= 0);
--> statement-breakpoint
ALTER TABLE "cost_events"
  ADD CONSTRAINT "cost_events_reasoning_tokens_nonneg"
  CHECK (reasoning_tokens >= 0);
