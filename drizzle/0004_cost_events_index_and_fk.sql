-- M5: Add composite index for cost analytics queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS "cost_events_provider_model_created_at_idx"
  ON "cost_events" ("provider", "model", "created_at");

-- M6: Add foreign key from cost_events.api_key_id to api_keys.id
ALTER TABLE "cost_events"
  ADD CONSTRAINT "cost_events_api_key_id_api_keys_id_fk"
  FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
