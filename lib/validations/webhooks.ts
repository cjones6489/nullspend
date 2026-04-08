import { z } from "zod";

import { nsIdInput, nsIdOutput } from "@/lib/ids/prefixed-id";
// Webhook URL validation delegates to the shared isSafeExternalUrl helper.
// That helper is strictly a superset: it additionally rejects user-info in
// URLs (the https://evil.com@good.com display-confusable attack), which
// closes a latent SSRF gap in the original webhook check.
import { isSafeExternalUrl as isValidWebhookUrl } from "./url-safety";

export const WEBHOOK_EVENT_TYPES = [
  "cost_event.created",
  "budget.threshold.warning",
  "budget.threshold.critical",
  "budget.exceeded",
  "budget.increased",
  "budget.reset",
  "request.blocked",
  "action.created",
  "action.approved",
  "action.rejected",
  "action.expired",
  "velocity.exceeded",
  "velocity.recovered",
  "session.limit_exceeded",
  "tag_budget.exceeded",
  "customer_budget.exceeded",
  "test.ping",
] as const;

export const PAYLOAD_MODES = ["full", "thin"] as const;

/** @deprecated Tier limits are enforced server-side. Use TIERS[tier].maxWebhookEndpoints. */
export const MAX_WEBHOOK_ENDPOINTS_PER_USER = Infinity;

export const createWebhookInputSchema = z.object({
  url: z.string().url().refine(isValidWebhookUrl, {
    message: "URL must be HTTPS and not point to private/reserved IP addresses",
  }),
  description: z.string().trim().max(200).optional(),
  eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).default([]),
  payloadMode: z.enum(PAYLOAD_MODES).default("full"),
});

export type CreateWebhookInput = z.infer<typeof createWebhookInputSchema>;

export const updateWebhookInputSchema = z.object({
  url: z.string().url().refine(isValidWebhookUrl, {
    message: "URL must be HTTPS and not point to private/reserved IP addresses",
  }).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)).optional(),
  enabled: z.boolean().optional(),
  payloadMode: z.enum(PAYLOAD_MODES).optional(),
});

export type UpdateWebhookInput = z.infer<typeof updateWebhookInputSchema>;

export const webhookRecordSchema = z.object({
  id: nsIdOutput("wh"),
  url: z.string(),
  description: z.string().nullable(),
  eventTypes: z.array(z.string()),
  enabled: z.boolean(),
  apiVersion: z.string(),
  payloadMode: z.enum(PAYLOAD_MODES),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type WebhookRecord = z.infer<typeof webhookRecordSchema>;

export const webhookIdParamsSchema = z.object({
  id: nsIdInput("wh"),
});

export const webhookDeliveryRecordSchema = z.object({
  id: nsIdOutput("del"),
  eventType: z.string(),
  eventId: z.string(),
  status: z.string(),
  attempts: z.number(),
  lastAttemptAt: z.string().nullable(),
  responseStatus: z.number().nullable(),
  createdAt: z.string(),
});

export type WebhookDeliveryRecord = z.infer<typeof webhookDeliveryRecordSchema>;
