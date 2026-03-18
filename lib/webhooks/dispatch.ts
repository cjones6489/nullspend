import { eq, and } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { getLogger } from "@/lib/observability";
import { webhookEndpoints } from "@nullspend/db";
import { signPayload } from "./signer";

export interface WebhookEvent {
  id: string;
  type: string;
  created_at: string;
  data: Record<string, unknown>;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  signingSecret: string;
  eventTypes: string[];
}

const DISPATCH_TIMEOUT_MS = 5_000;
const log = getLogger("webhook-dispatch");

/**
 * Fetch all enabled webhook endpoints for a user.
 * Extracted so callers can query once and dispatch many events.
 */
export async function fetchWebhookEndpoints(
  userId: string,
): Promise<WebhookEndpoint[]> {
  const db = getDb();
  return db
    .select({
      id: webhookEndpoints.id,
      url: webhookEndpoints.url,
      signingSecret: webhookEndpoints.signingSecret,
      eventTypes: webhookEndpoints.eventTypes,
    })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.userId, userId),
        eq(webhookEndpoints.enabled, true),
      ),
    );
}

/**
 * Dispatch a webhook event to pre-fetched endpoints.
 * Fire-and-forget: logs errors but never throws.
 */
export async function dispatchToEndpoints(
  endpoints: WebhookEndpoint[],
  event: WebhookEvent,
): Promise<void> {
  if (endpoints.length === 0) return;

  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);

  for (const endpoint of endpoints) {
    // Event type filter: empty array = all events
    if (
      endpoint.eventTypes.length > 0 &&
      !endpoint.eventTypes.includes(event.type)
    ) {
      continue;
    }

    try {
      const signature = signPayload(payload, endpoint.signingSecret, timestamp);

      await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NullSpend-Signature": signature,
          "X-NullSpend-Webhook-Id": event.id,
          "X-NullSpend-Webhook-Timestamp": String(timestamp),
          "User-Agent": "NullSpend-Webhooks/1.0",
        },
        body: payload,
        signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
      });
    } catch (err) {
      log.error(
        { err, endpointId: endpoint.id, eventType: event.type },
        `Failed to dispatch ${event.type} to endpoint ${endpoint.id}`,
      );
    }
  }
}

/**
 * Convenience: fetch endpoints + dispatch a single event.
 * Fire-and-forget: logs errors but never throws.
 */
export async function dispatchWebhookEvent(
  userId: string,
  event: WebhookEvent,
): Promise<void> {
  try {
    const endpoints = await fetchWebhookEndpoints(userId);
    await dispatchToEndpoints(endpoints, event);
  } catch (err) {
    log.error(
      { err, userId },
      "Failed to load webhook endpoints for dispatch",
    );
  }
}

/**
 * Build a cost_event.created webhook event payload.
 * Aligned with the proxy's buildCostEventPayload schema.
 */
export function buildCostEventWebhookPayload(
  costEvent: {
    requestId: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    costMicrodollars: number;
    durationMs: number | null;
    eventType: string;
    toolName?: string | null;
    toolServer?: string | null;
    sessionId?: string | null;
    apiKeyId: string | null;
  },
): WebhookEvent {
  const now = new Date().toISOString();
  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "cost_event.created",
    created_at: now,
    data: {
      request_id: costEvent.requestId,
      event_type: costEvent.eventType,
      provider: costEvent.provider,
      model: costEvent.model,
      input_tokens: costEvent.inputTokens,
      output_tokens: costEvent.outputTokens,
      cached_input_tokens: costEvent.cachedInputTokens,
      cost_microdollars: costEvent.costMicrodollars,
      duration_ms: costEvent.durationMs,
      upstream_duration_ms: null,
      session_id: costEvent.sessionId ?? null,
      tool_name: costEvent.toolName ?? null,
      tool_server: costEvent.toolServer ?? null,
      tool_calls_requested: null,
      tool_definition_tokens: 0,
      api_key_id: costEvent.apiKeyId,
      created_at: now,
    },
  };
}
