import { z } from "zod";

import { nsIdInput, nsIdOutput } from "@/lib/ids/prefixed-id";

export const WEBHOOK_EVENT_TYPES = [
  "cost_event.created",
  "budget.threshold.warning",
  "budget.threshold.critical",
  "budget.exceeded",
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
  "test.ping",
] as const;

export const PAYLOAD_MODES = ["full", "thin"] as const;

/** UI display hint — actual limit enforced per-tier in the route handler. */
export const MAX_WEBHOOK_ENDPOINTS_PER_USER = 50;

function isValidWebhookUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  const hostname = parsed.hostname;

  // Block IPv6 literals entirely — real webhook URLs use DNS hostnames
  if (hostname.startsWith("[")) return false;

  // Block loopback range (127.0.0.0/8), bind-all, and localhost
  if (hostname === "localhost") return false;
  if (hostname.startsWith("127.")) return false;
  if (hostname === "0.0.0.0") return false;

  // Block private RFC 1918 ranges
  if (hostname.startsWith("10.")) return false;
  if (hostname.startsWith("192.168.")) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;

  // Block link-local and metadata
  if (hostname.startsWith("169.254.")) return false;
  if (hostname.endsWith(".local")) return false;

  return true;
}

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
