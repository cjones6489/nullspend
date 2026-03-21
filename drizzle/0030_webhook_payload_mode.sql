ALTER TABLE "webhook_endpoints" ADD COLUMN "payload_mode" text NOT NULL DEFAULT 'full';
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_payload_mode_check"
  CHECK ("payload_mode" IN ('full', 'thin'));
