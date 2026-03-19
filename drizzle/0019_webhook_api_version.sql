ALTER TABLE webhook_endpoints ADD COLUMN api_version text NOT NULL DEFAULT '2026-04-01';

-- Clean up removed event type from any stored eventTypes arrays
UPDATE webhook_endpoints
SET event_types = array_replace(event_types, 'request.blocked.budget', 'request.blocked')
WHERE 'request.blocked.budget' = ANY(event_types);
