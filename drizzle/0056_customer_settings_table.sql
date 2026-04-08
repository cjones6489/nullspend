-- Phase 0 audit follow-up (Issue 1): decouple per-customer upgrade_url
-- from customer_mappings (which is Stripe-revenue-sync-specific) into
-- a dedicated customer_settings table keyed on (org_id, customer_id).
--
-- Rolls back drizzle/0055's ALTER TABLE customer_mappings ADD COLUMN
-- upgrade_url and replaces it with the new table. Safe because 0055
-- shipped empty (no rows had upgrade_url set yet).

CREATE TABLE customer_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  upgrade_url text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, customer_id)
);

CREATE INDEX customer_settings_org_customer_idx
  ON customer_settings (org_id, customer_id);

-- Drop the misplaced column from customer_mappings.
ALTER TABLE customer_mappings DROP COLUMN IF EXISTS upgrade_url;
