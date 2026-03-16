-- Webhook endpoint configuration
CREATE TABLE webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  signing_secret TEXT NOT NULL,
  event_types TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhook_endpoints_user_id_idx ON webhook_endpoints (user_id);

-- RLS
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;

-- Revoke anon access (matches existing pattern from 0011)
REVOKE ALL ON webhook_endpoints FROM anon;

-- RLS policy for authenticated users
CREATE POLICY webhook_endpoints_user_policy ON webhook_endpoints
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- Auto-update updated_at via moddatetime (extension enabled in 0012)
CREATE TRIGGER set_webhook_endpoints_updated_at
  BEFORE UPDATE ON webhook_endpoints
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);
