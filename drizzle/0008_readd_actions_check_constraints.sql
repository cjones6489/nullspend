-- H9: Re-add CHECK constraints that were dropped in 0002_certain_mandroid.sql
ALTER TABLE "actions"
  ADD CONSTRAINT "actions_status_check"
  CHECK (status IN ('pending','approved','rejected','expired','executing','executed','failed'));
--> statement-breakpoint
ALTER TABLE "actions"
  ADD CONSTRAINT "actions_action_type_check"
  CHECK (action_type IN ('send_email','http_post','http_delete','shell_command','db_write','file_write','file_delete'));
