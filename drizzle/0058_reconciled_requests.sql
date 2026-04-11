-- PXY-2: Idempotent budget spend reconciliation.
-- Dedup table prevents double-counting when PG writes are retried
-- (queue retry, outbox alarm retry, manual recovery).
CREATE TABLE "reconciled_requests" (
	"request_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"org_id" uuid NOT NULL,
	"cost_microdollars" bigint NOT NULL,
	"reconciled_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("request_id", "entity_type", "entity_id")
);
--> statement-breakpoint
CREATE INDEX "reconciled_requests_reconciled_at_idx" ON "reconciled_requests" ("reconciled_at");
