-- Allow 'custom' event_type for SDK-reported cost events.
-- The CHECK constraint from 0016 only permitted ('llm', 'tool').
-- The schema and SDK type already allow 'custom'; this migration
-- brings the database in sync.

ALTER TABLE cost_events DROP CONSTRAINT IF EXISTS cost_events_event_type_check;

ALTER TABLE cost_events ADD CONSTRAINT cost_events_event_type_check
  CHECK (event_type IN ('llm', 'tool', 'custom'));
