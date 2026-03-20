ALTER TABLE cost_events ADD COLUMN tags jsonb NOT NULL DEFAULT '{}';
CREATE INDEX cost_events_tags_idx ON cost_events USING GIN (tags);
