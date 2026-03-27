-- Replace single-column session_id index with compound index
-- optimized for session replay queries:
--   WHERE org_id = X AND session_id = Y ORDER BY created_at
-- Partial index (WHERE session_id IS NOT NULL) avoids indexing
-- the majority of rows that have no session.
DROP INDEX IF EXISTS "cost_events_session_id_idx";
CREATE INDEX "cost_events_org_session_created_idx" ON "cost_events" ("org_id", "session_id", "created_at") WHERE session_id IS NOT NULL;
