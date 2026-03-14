-- L1: Auto-update updatedAt columns on UPDATE

-- Enable moddatetime extension (available on Supabase)
CREATE EXTENSION IF NOT EXISTS moddatetime;

-- Trigger for slack_configs.updated_at
CREATE TRIGGER set_slack_configs_updated_at
  BEFORE UPDATE ON slack_configs
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);

-- Trigger for budgets.updated_at
CREATE TRIGGER set_budgets_updated_at
  BEFORE UPDATE ON budgets
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);
