ALTER TABLE cost_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'llm'
  CHECK (event_type IN ('llm', 'tool'));
ALTER TABLE cost_events ADD COLUMN tool_name TEXT;
ALTER TABLE cost_events ADD COLUMN tool_server TEXT;
ALTER TABLE cost_events ADD COLUMN tool_calls_requested JSONB;
ALTER TABLE cost_events ADD COLUMN tool_definition_tokens INTEGER DEFAULT 0;
ALTER TABLE cost_events ADD COLUMN upstream_duration_ms INTEGER;
ALTER TABLE cost_events ADD COLUMN session_id TEXT;
ALTER TABLE cost_events ADD COLUMN cost_breakdown JSONB;

CREATE INDEX cost_events_event_type_idx ON cost_events (event_type);
CREATE INDEX cost_events_session_id_idx ON cost_events (session_id)
  WHERE session_id IS NOT NULL;
CREATE INDEX cost_events_tool_server_name_idx
  ON cost_events (tool_server, tool_name)
  WHERE event_type = 'tool';
