-- Make budgets.user_id NOT NULL to enforce unique index correctness
-- (unique index on nullable columns doesn't prevent duplicate NULL rows in Postgres)
ALTER TABLE "budgets" ALTER COLUMN "user_id" SET NOT NULL;
