-- Make cost_events.user_id NOT NULL — all rows verified non-null (10,840 rows checked)
-- Eliminates leftJoin in all aggregation queries, enables clean single-index scans
ALTER TABLE "cost_events" ALTER COLUMN "user_id" SET NOT NULL;
