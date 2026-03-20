ALTER TABLE cost_events ADD COLUMN trace_id TEXT;
CREATE INDEX cost_events_trace_id_idx ON cost_events (trace_id)
  WHERE trace_id IS NOT NULL;
