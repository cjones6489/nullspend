CREATE TABLE "margin_alerts_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tag_value" text NOT NULL,
	"period" text NOT NULL,
	"from_tier" text NOT NULL,
	"to_tier" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "margin_alerts_sent" ADD CONSTRAINT "margin_alerts_sent_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "margin_alerts_sent_dedup_idx" ON "margin_alerts_sent" USING btree ("org_id","tag_value","period","to_tier");--> statement-breakpoint
CREATE INDEX "margin_alerts_sent_org_period_idx" ON "margin_alerts_sent" USING btree ("org_id","period");