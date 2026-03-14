-- L23: Ensure cost events have at least one attribution identifier
-- Every cost event must have either a user_id or an api_key_id (or both)

ALTER TABLE cost_events
  ADD CONSTRAINT cost_events_attribution_check
  CHECK (user_id IS NOT NULL OR api_key_id IS NOT NULL);
