-- Add CHECK constraints for budget columns (M18, L34)
ALTER TABLE budgets
  ADD CONSTRAINT budgets_entity_type_check
  CHECK (entity_type IN ('user', 'agent', 'api_key', 'team'));

ALTER TABLE budgets
  ADD CONSTRAINT budgets_policy_check
  CHECK (policy IN ('strict_block', 'soft_block', 'warn'));

ALTER TABLE budgets
  ADD CONSTRAINT budgets_reset_interval_check
  CHECK (reset_interval IS NULL OR reset_interval IN ('daily', 'weekly', 'monthly', 'yearly'));
