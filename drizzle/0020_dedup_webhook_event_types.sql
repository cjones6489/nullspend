-- Dedup event_types arrays that may have duplicates after 0019 array_replace
UPDATE webhook_endpoints
SET event_types = (SELECT array_agg(DISTINCT t ORDER BY t) FROM unnest(event_types) t)
WHERE event_types <> (SELECT array_agg(DISTINCT t ORDER BY t) FROM unnest(event_types) t);
