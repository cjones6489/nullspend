-- Margins feature: Stripe connections, customer revenue, customer mappings

CREATE TABLE "stripe_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "encrypted_key" text NOT NULL,
  "key_prefix" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL
    CHECK ("status" IN ('active', 'error', 'revoked')),
  "last_sync_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_connections_org_id_idx" ON "stripe_connections" USING btree ("org_id");
--> statement-breakpoint

CREATE TABLE "customer_revenue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "stripe_customer_id" text NOT NULL,
  "customer_name" text,
  "customer_email" text,
  "avatar_url" text,
  "period_start" timestamp with time zone NOT NULL,
  "amount_microdollars" bigint NOT NULL,
  "invoice_count" integer DEFAULT 1 NOT NULL,
  "currency" text DEFAULT 'usd' NOT NULL
    CHECK ("currency" IN ('usd')),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_revenue_org_customer_period_idx"
  ON "customer_revenue" USING btree ("org_id", "stripe_customer_id", "period_start");
--> statement-breakpoint
CREATE INDEX "customer_revenue_org_period_idx"
  ON "customer_revenue" USING btree ("org_id", "period_start");
--> statement-breakpoint

CREATE TABLE "customer_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "stripe_customer_id" text NOT NULL,
  "tag_key" text DEFAULT 'customer' NOT NULL,
  "tag_value" text NOT NULL,
  "match_type" text NOT NULL
    CHECK ("match_type" IN ('auto', 'manual')),
  "confidence" real,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_mappings_org_stripe_tag_idx"
  ON "customer_mappings" USING btree ("org_id", "stripe_customer_id", "tag_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_mappings_org_tag_value_idx"
  ON "customer_mappings" USING btree ("org_id", "tag_key", "tag_value");
--> statement-breakpoint

-- RLS
ALTER TABLE "stripe_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_revenue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_mappings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Revoke anon access (matches existing convention)
REVOKE ALL ON "stripe_connections" FROM anon;
REVOKE ALL ON "customer_revenue" FROM anon;
REVOKE ALL ON "customer_mappings" FROM anon;
--> statement-breakpoint

-- updated_at trigger (matches existing convention from 0012_add_updated_at_trigger.sql)
CREATE TRIGGER set_updated_at_stripe_connections
  BEFORE UPDATE ON "stripe_connections"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_updated_at_customer_revenue
  BEFORE UPDATE ON "customer_revenue"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
