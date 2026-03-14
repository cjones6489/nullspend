-- M18: Budget max must be positive, spend must be non-negative
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_max_budget_positive"
  CHECK (max_budget_microdollars > 0);
--> statement-breakpoint
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_spend_nonneg"
  CHECK (spend_microdollars >= 0);
