-- Phase 0 edge-case audit E3: drop redundant customer_settings index.
--
-- The UNIQUE (org_id, customer_id) constraint in 0056 automatically
-- creates an equivalent btree index (customer_settings_org_id_customer_id_key).
-- The explicit CREATE INDEX customer_settings_org_customer_idx in 0056
-- was pure duplicate work — doubles write cost on every INSERT/UPDATE
-- and wastes disk space for no query plan benefit.
--
-- This migration drops the redundant index. Only the constraint's
-- auto-index remains on (org_id, customer_id).
--
-- Schema.ts was also updated to stop declaring a uniqueIndex for this
-- column pair — the UNIQUE constraint alone is sufficient.

DROP INDEX IF EXISTS customer_settings_org_customer_idx;
