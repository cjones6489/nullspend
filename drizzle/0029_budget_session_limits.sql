-- Session-level budget aggregation: add session_limit_microdollars to budgets table
ALTER TABLE "budgets" ADD COLUMN "session_limit_microdollars" bigint;
