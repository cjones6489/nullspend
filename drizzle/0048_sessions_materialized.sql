-- Materialized sessions table: populated by trigger on cost_events INSERT.
-- Eliminates the expensive GROUP BY query on the sessions list page.

CREATE TABLE sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL,
  session_id TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  total_cost_microdollars BIGINT NOT NULL DEFAULT 0,
  total_input_tokens INTEGER NOT NULL DEFAULT 0,
  total_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_duration_ms INTEGER NOT NULL DEFAULT 0,
  first_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX sessions_org_session_idx ON sessions (org_id, session_id);
CREATE INDEX sessions_org_last_event_idx ON sessions (org_id, last_event_at);

-- Trigger function: upsert into sessions on every cost_events INSERT with session_id
CREATE OR REPLACE FUNCTION upsert_session_on_cost_event()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    INSERT INTO sessions (org_id, session_id, event_count, total_cost_microdollars, total_input_tokens, total_output_tokens, total_duration_ms, first_event_at, last_event_at)
    VALUES (NEW.org_id, NEW.session_id, 1, NEW.cost_microdollars, NEW.input_tokens, NEW.output_tokens, COALESCE(NEW.duration_ms, 0), NEW.created_at, NEW.created_at)
    ON CONFLICT (org_id, session_id) DO UPDATE SET
      event_count = sessions.event_count + 1,
      total_cost_microdollars = sessions.total_cost_microdollars + EXCLUDED.total_cost_microdollars,
      total_input_tokens = sessions.total_input_tokens + EXCLUDED.total_input_tokens,
      total_output_tokens = sessions.total_output_tokens + EXCLUDED.total_output_tokens,
      total_duration_ms = sessions.total_duration_ms + EXCLUDED.total_duration_ms,
      last_event_at = GREATEST(sessions.last_event_at, EXCLUDED.last_event_at),
      updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_upsert_session
  AFTER INSERT ON cost_events
  FOR EACH ROW
  EXECUTE FUNCTION upsert_session_on_cost_event();

-- Backfill: populate sessions table from existing cost_events
INSERT INTO sessions (org_id, session_id, event_count, total_cost_microdollars, total_input_tokens, total_output_tokens, total_duration_ms, first_event_at, last_event_at, created_at, updated_at)
SELECT
  org_id,
  session_id,
  COUNT(*)::int,
  SUM(cost_microdollars)::bigint,
  SUM(input_tokens)::int,
  SUM(output_tokens)::int,
  SUM(COALESCE(duration_ms, 0))::int,
  MIN(created_at),
  MAX(created_at),
  MIN(created_at),
  NOW()
FROM cost_events
WHERE session_id IS NOT NULL
GROUP BY org_id, session_id
ON CONFLICT (org_id, session_id) DO NOTHING;
