ALTER TABLE webhook_endpoints
  ADD COLUMN previous_signing_secret text,
  ADD COLUMN secret_rotated_at timestamptz;
