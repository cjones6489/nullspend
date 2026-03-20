-- Velocity limits: sliding window cost-rate detection + circuit breaker
ALTER TABLE budgets ADD COLUMN velocity_limit_microdollars BIGINT;
ALTER TABLE budgets ADD COLUMN velocity_window_seconds INTEGER DEFAULT 60;
ALTER TABLE budgets ADD COLUMN velocity_cooldown_seconds INTEGER DEFAULT 60;
