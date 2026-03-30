-- Add model and provider restriction columns to api_keys
ALTER TABLE api_keys ADD COLUMN allowed_models text[] DEFAULT NULL;
ALTER TABLE api_keys ADD COLUMN allowed_providers text[] DEFAULT NULL;
