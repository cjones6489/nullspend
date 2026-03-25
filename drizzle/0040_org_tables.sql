-- Phase 1 Increment 1: Organization tables

CREATE TABLE "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "is_personal" boolean NOT NULL DEFAULT false,
  "logo_url" text,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Enforces one personal org per user (prevents race condition duplicates)
CREATE UNIQUE INDEX "organizations_personal_user_idx"
  ON "organizations" ("created_by") WHERE is_personal = true;

CREATE TABLE "org_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "org_memberships_org_user_idx" ON "org_memberships" ("org_id", "user_id");
CREATE INDEX "org_memberships_user_id_idx" ON "org_memberships" ("user_id");

CREATE TABLE "org_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  "invited_by" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "token_prefix" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "accepted_by" text,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "accepted_at" timestamptz,
  "revoked_at" timestamptz
);

CREATE INDEX "org_invitations_org_id_idx" ON "org_invitations" ("org_id");
CREATE INDEX "org_invitations_email_idx" ON "org_invitations" ("email");
CREATE UNIQUE INDEX "org_invitations_pending_idx"
  ON "org_invitations" ("org_id", "email") WHERE status = 'pending';
