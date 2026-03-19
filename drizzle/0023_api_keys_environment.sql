ALTER TABLE api_keys
  ADD COLUMN environment text NOT NULL DEFAULT 'live';
