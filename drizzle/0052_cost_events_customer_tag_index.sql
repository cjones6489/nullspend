-- Functional index for customer tag queries (margins feature).
-- Must run outside a transaction (CONCURRENTLY).
-- Run manually: psql $DATABASE_URL -f drizzle/0052_cost_events_customer_tag_index.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS "cost_events_org_customer_tag_idx"
  ON "cost_events" ("org_id", (tags->>'customer'), "created_at")
  WHERE tags ? 'customer';
