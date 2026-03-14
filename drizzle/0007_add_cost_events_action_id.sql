-- C1: Add action_id column to cost_events (schema has it, DB does not)
ALTER TABLE "cost_events"
  ADD COLUMN "action_id" uuid;
--> statement-breakpoint
ALTER TABLE "cost_events"
  ADD CONSTRAINT "cost_events_action_id_actions_id_fk"
  FOREIGN KEY ("action_id") REFERENCES "actions"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint
CREATE INDEX "cost_events_action_id_idx" ON "cost_events" USING btree ("action_id");
