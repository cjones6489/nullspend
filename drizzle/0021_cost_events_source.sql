ALTER TABLE cost_events
  ADD COLUMN source text NOT NULL DEFAULT 'proxy'
  CONSTRAINT cost_events_source_check CHECK (source IN ('proxy', 'api', 'mcp'));
