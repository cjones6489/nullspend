-- Webhook delivery log
CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed', 'exhausted')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  response_status INTEGER,
  response_body_preview TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhook_deliveries_endpoint_id_idx
  ON webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX webhook_deliveries_event_id_idx
  ON webhook_deliveries (event_id);

-- RLS
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Revoke anon access
REVOKE ALL ON webhook_deliveries FROM anon;

-- RLS policy: users can see deliveries for their own endpoints
CREATE POLICY webhook_deliveries_user_policy ON webhook_deliveries
  FOR ALL
  TO authenticated
  USING (
    endpoint_id IN (
      SELECT id FROM webhook_endpoints WHERE user_id = auth.uid()::text
    )
  );
