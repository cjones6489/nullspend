CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "org_id" uuid NOT NULL,
  "actor_id" text NOT NULL,
  "action" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "audit_events_org_id_idx" ON "audit_events" ("org_id");
CREATE INDEX "audit_events_created_at_idx" ON "audit_events" ("created_at");
