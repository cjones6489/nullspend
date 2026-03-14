-- H8: Enable RLS on all application tables
-- M15: Revoke all privileges from anon role

-- Enable RLS
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_events ENABLE ROW LEVEL SECURITY;

-- RLS policies for authenticated role (scoped to auth.uid())
CREATE POLICY "users can view own api_keys"
  ON api_keys FOR SELECT
  TO authenticated
  USING (user_id = auth.uid()::text);

CREATE POLICY "users can insert own api_keys"
  ON api_keys FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "users can update own api_keys"
  ON api_keys FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid()::text);

CREATE POLICY "users can view own actions"
  ON actions FOR SELECT
  TO authenticated
  USING (owner_user_id = auth.uid()::text);

CREATE POLICY "users can insert own actions"
  ON actions FOR INSERT
  TO authenticated
  WITH CHECK (owner_user_id = auth.uid()::text);

CREATE POLICY "users can update own actions"
  ON actions FOR UPDATE
  TO authenticated
  USING (owner_user_id = auth.uid()::text);

CREATE POLICY "users can view own slack_configs"
  ON slack_configs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid()::text);

CREATE POLICY "users can manage own slack_configs"
  ON slack_configs FOR ALL
  TO authenticated
  USING (user_id = auth.uid()::text);

CREATE POLICY "users can view own budgets"
  ON budgets FOR SELECT
  TO authenticated
  USING (
    (entity_type = 'user' AND entity_id = auth.uid()::text)
    OR (entity_type = 'api_key' AND entity_id IN (
      SELECT id::text FROM api_keys WHERE user_id = auth.uid()::text
    ))
  );

CREATE POLICY "users can manage own budgets"
  ON budgets FOR ALL
  TO authenticated
  USING (
    (entity_type = 'user' AND entity_id = auth.uid()::text)
    OR (entity_type = 'api_key' AND entity_id IN (
      SELECT id::text FROM api_keys WHERE user_id = auth.uid()::text
    ))
  );

CREATE POLICY "users can view own cost_events"
  ON cost_events FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()::text
    OR api_key_id IN (
      SELECT id FROM api_keys WHERE user_id = auth.uid()::text
    )
  );

-- M15: Revoke all privileges from anon role on application tables
REVOKE ALL ON api_keys FROM anon;
REVOKE ALL ON actions FROM anon;
REVOKE ALL ON slack_configs FROM anon;
REVOKE ALL ON budgets FROM anon;
REVOKE ALL ON cost_events FROM anon;
