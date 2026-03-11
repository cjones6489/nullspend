-- Add slack_user_id column for Slack callback authorization (H7)
-- When set, only the matching Slack user can approve/reject actions.
-- NULL means any workspace member can interact (backwards-compatible).
ALTER TABLE "slack_configs" ADD COLUMN "slack_user_id" text;
