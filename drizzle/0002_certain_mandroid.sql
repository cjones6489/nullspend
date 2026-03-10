CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"max_budget_microdollars" bigint NOT NULL,
	"spend_microdollars" bigint DEFAULT 0 NOT NULL,
	"policy" text DEFAULT 'strict_block' NOT NULL,
	"reset_interval" text,
	"current_period_start" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL,
	"api_key_id" uuid,
	"user_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cost_microdollars" bigint NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"webhook_url" text NOT NULL,
	"channel_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_configs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "actions" DROP CONSTRAINT "actions_status_check";--> statement-breakpoint
ALTER TABLE "actions" DROP CONSTRAINT "actions_action_type_check";--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
-- Backfill any null rows (should be zero, but safety first)
DELETE FROM "actions" WHERE "owner_user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "actions" ALTER COLUMN "owner_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_entity_type_entity_id_idx" ON "budgets" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_events_request_id_provider_idx" ON "cost_events" USING btree ("request_id","provider");--> statement-breakpoint
CREATE INDEX "cost_events_user_id_created_at_idx" ON "cost_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "cost_events_api_key_id_created_at_idx" ON "cost_events" USING btree ("api_key_id","created_at");--> statement-breakpoint
CREATE INDEX "actions_owner_status_created_idx" ON "actions" USING btree ("owner_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "actions_owner_created_idx" ON "actions" USING btree ("owner_user_id","created_at");