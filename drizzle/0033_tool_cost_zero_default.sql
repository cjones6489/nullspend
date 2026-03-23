-- Add suggested_cost column for annotation-based price suggestions
ALTER TABLE tool_costs ADD COLUMN suggested_cost BIGINT NOT NULL DEFAULT 0;

-- Change default for new discoveries from $0.01 to $0.00
ALTER TABLE tool_costs ALTER COLUMN cost_microdollars SET DEFAULT 0;

-- Backfill suggested_cost from existing annotations JSONB
-- TIER_FREE ($0.00): readOnlyHint=true AND openWorldHint=false
-- TIER_WRITE ($0.10): destructiveHint=true AND openWorldHint=true
-- TIER_READ ($0.01): everything else
UPDATE tool_costs SET suggested_cost = CASE
  WHEN annotations IS NOT NULL
    AND (annotations->>'readOnlyHint')::boolean = true
    AND (annotations->>'openWorldHint')::boolean = false
  THEN 0
  WHEN annotations IS NOT NULL
    AND (annotations->>'destructiveHint')::boolean = true
    AND (annotations->>'openWorldHint')::boolean = true
  THEN 100000
  ELSE 10000
END;
