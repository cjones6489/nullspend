-- Phase 4c: Migrate subscriptions from per-user to per-org billing.
-- Since there are zero real users, this is a clean schema change with no data migration.

-- Drop the per-user unique constraint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_user_id_unique";

-- Add per-org unique constraint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_unique" UNIQUE ("org_id");
