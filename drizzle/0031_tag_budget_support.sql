BEGIN;

ALTER TABLE budgets ADD COLUMN user_id TEXT;

-- Backfill: user budgets store userId as entity_id
UPDATE budgets SET user_id = entity_id WHERE entity_type = 'user';

-- Backfill: api_key budgets join through api_keys table
-- Uses LEFT JOIN so orphaned budgets get NULL (not a failure)
UPDATE budgets SET user_id = ak.user_id
FROM api_keys ak
WHERE budgets.entity_type = 'api_key' AND ak.id::text = budgets.entity_id;

CREATE INDEX budgets_user_id_idx ON budgets(user_id);

COMMIT;
