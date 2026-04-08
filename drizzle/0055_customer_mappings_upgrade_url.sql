-- Phase 0 finish (Item 2): per-customer upgrade URL.
--
-- Adds an optional `upgrade_url` column to customer_mappings so each
-- customer can point at its own plan-upgrade page in denial responses.
-- When null, the proxy falls back to `organizations.metadata.upgradeUrl`
-- (org-level default). Supports the `{customer_id}` placeholder which
-- is substituted at denial time by `resolveUpgradeUrl`.
--
-- No default, no NOT NULL — existing rows remain unaffected.

ALTER TABLE customer_mappings ADD COLUMN upgrade_url text;
