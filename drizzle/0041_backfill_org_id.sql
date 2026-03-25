-- Phase 2 Increment 3: Backfill org_id on all existing rows
-- Creates personal orgs for all distinct users, then updates org_id

-- Step 1: Create personal orgs for all distinct user_ids across all tables
WITH distinct_users AS (
  SELECT DISTINCT user_id FROM api_keys WHERE user_id IS NOT NULL AND org_id IS NULL
  UNION
  SELECT DISTINCT user_id FROM cost_events WHERE user_id IS NOT NULL AND org_id IS NULL
  UNION
  SELECT DISTINCT user_id FROM budgets WHERE user_id IS NOT NULL AND org_id IS NULL
  UNION
  SELECT DISTINCT owner_user_id FROM actions WHERE owner_user_id IS NOT NULL AND org_id IS NULL
),
new_orgs AS (
  INSERT INTO organizations (name, slug, is_personal, created_by)
  SELECT
    'Personal',
    'user-' || left(du.user_id, 8) || '-' || to_hex(extract(epoch from now())::bigint),
    true,
    du.user_id
  FROM distinct_users du
  WHERE NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.created_by = du.user_id AND o.is_personal = true
  )
  RETURNING id, created_by
),
new_memberships AS (
  INSERT INTO org_memberships (org_id, user_id, role)
  SELECT no.id, no.created_by, 'owner'
  FROM new_orgs no
  RETURNING org_id, user_id
)
SELECT COUNT(*) FROM new_orgs;

-- Step 2: Backfill org_id on all tables using the personal org mapping
UPDATE api_keys ak
SET org_id = o.id
FROM organizations o
WHERE o.created_by = ak.user_id AND o.is_personal = true AND ak.org_id IS NULL;

UPDATE budgets b
SET org_id = o.id
FROM organizations o
WHERE o.created_by = b.user_id AND o.is_personal = true AND b.org_id IS NULL;

UPDATE cost_events ce
SET org_id = o.id
FROM organizations o
WHERE o.created_by = ce.user_id AND o.is_personal = true AND ce.org_id IS NULL;

UPDATE webhook_endpoints we
SET org_id = o.id
FROM organizations o
WHERE o.created_by = we.user_id AND o.is_personal = true AND we.org_id IS NULL;

UPDATE tool_costs tc
SET org_id = o.id
FROM organizations o
WHERE o.created_by = tc.user_id AND o.is_personal = true AND tc.org_id IS NULL;

UPDATE actions a
SET org_id = o.id
FROM organizations o
WHERE o.created_by = a.owner_user_id AND o.is_personal = true AND a.org_id IS NULL;

UPDATE slack_configs sc
SET org_id = o.id
FROM organizations o
WHERE o.created_by = sc.user_id AND o.is_personal = true AND sc.org_id IS NULL;

UPDATE subscriptions s
SET org_id = o.id
FROM organizations o
WHERE o.created_by = s.user_id AND o.is_personal = true AND s.org_id IS NULL;
