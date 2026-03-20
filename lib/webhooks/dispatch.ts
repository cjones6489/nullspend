// SYNC: Proxy WebhookEvent interface in apps/proxy/src/lib/webhook-events.ts must match this shape

import { and, eq, lt } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { getLogger } from "@/lib/observability";
import { webhookEndpoints } from "@nullspend/db";
import { dualSignPayload, SECRET_ROTATION_WINDOW_SECONDS } from "./signer";

const CURRENT_API_VERSION = "2026-04-01";

export interface WebhookEvent {
  id: string;
  type: string;
  api_version: string;
  created_at: number;
  data: { object: Record<string, unknown> };
}

interface WebhookEndpoint {
  id: string;
  url: string;
  signingSecret: string;
  previousSigningSecret: string | null;
  secretRotatedAt: Date | null;
  eventTypes: string[];
  apiVersion: string;
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
      previousSigningSecret: webhookEndpoints.previousSigningSecret,
      secretRotatedAt: webhookEndpoints.secretRotatedAt,
      eventTypes: webhookEndpoints.eventTypes,
      apiVersion: webhookEndpoints.apiVersion,
    })
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.userId, userId),
        eq(webhookEndpoints.enabled, true),
      ),
    );
}

function isSecretActive(ep: WebhookEndpoint): boolean {
  if (!ep.previousSigningSecret || !ep.secretRotatedAt) return false;
  return Date.now() - ep.secretRotatedAt.getTime() < SECRET_ROTATION_WINDOW_SECONDS * 1000;
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
      const previousSecret = isSecretActive(endpoint) ? endpoint.previousSigningSecret : null;
      const signature = dualSignPayload(payload, endpoint.signingSecret, previousSecret, timestamp);

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

  // Lazy expiry: clean up expired rotation secrets (fire-and-forget, never awaited)
  const cutoff = new Date(Date.now() - SECRET_ROTATION_WINDOW_SECONDS * 1000);
  const expiredEndpoints = endpoints.filter(
    (ep) => ep.secretRotatedAt && ep.secretRotatedAt < cutoff,
  );
  if (expiredEndpoints.length > 0) {
    const db = getDb();
    void (async () => {
      for (const ep of expiredEndpoints) {
        try {
          await db
            .update(webhookEndpoints)
            .set({ previousSigningSecret: null, secretRotatedAt: null })
            .where(
              and(
                eq(webhookEndpoints.id, ep.id),
                lt(webhookEndpoints.secretRotatedAt, cutoff),
              ),
            );
        } catch {
          // fire-and-forget
        }
      }
    })();
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
    upstreamDurationMs?: number | null;
    toolCallsRequested?: { name: string; id: string }[] | null;
    toolDefinitionTokens?: number;
    source?: string;
    tags?: Record<string, string>;
  },
  apiVersion: string = CURRENT_API_VERSION,
): WebhookEvent {
  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "cost_event.created",
    api_version: apiVersion,
    created_at: Math.floor(Date.now() / 1000),
    data: {
      object: {
        request_id: costEvent.requestId,
        event_type: costEvent.eventType,
        provider: costEvent.provider,
        model: costEvent.model,
        input_tokens: costEvent.inputTokens,
        output_tokens: costEvent.outputTokens,
        cached_input_tokens: costEvent.cachedInputTokens,
        cost_microdollars: costEvent.costMicrodollars,
        duration_ms: costEvent.durationMs,
        upstream_duration_ms: costEvent.upstreamDurationMs ?? null,
        session_id: costEvent.sessionId ?? null,
        tool_name: costEvent.toolName ?? null,
        tool_server: costEvent.toolServer ?? null,
        tool_calls_requested: costEvent.toolCallsRequested ?? null,
        tool_definition_tokens: costEvent.toolDefinitionTokens ?? 0,
        api_key_id: costEvent.apiKeyId,
        source: costEvent.source ?? null,
        tags: costEvent.tags ?? {},
        created_at: new Date().toISOString(),
      },
    },
  };
}

/**
 * Build action lifecycle webhook payloads.
 * WH-2: wire into action lifecycle
 */
export function buildActionCreatedPayload(
  action: {
    id: string;
    actionType: string;
    agentId: string;
    status: string;
    payloadJson: Record<string, unknown>;
    createdAt: string;
    expiresAt?: string | null;
  },
  apiVersion: string = CURRENT_API_VERSION,
): WebhookEvent {
  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "action.created",
    api_version: apiVersion,
    created_at: Math.floor(Date.now() / 1000),
    data: {
      object: {
        action_id: action.id,
        action_type: action.actionType,
        agent_id: action.agentId,
        status: action.status,
        payload: action.payloadJson,
        created_at: action.createdAt,
        expires_at: action.expiresAt ?? null,
      },
    },
  };
}

export function buildActionApprovedPayload(
  action: {
    id: string;
    actionType: string;
    agentId: string;
    status: string;
    approvedBy: string | null;
    approvedAt: string | null;
  },
  apiVersion: string = CURRENT_API_VERSION,
): WebhookEvent {
  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "action.approved",
    api_version: apiVersion,
    created_at: Math.floor(Date.now() / 1000),
    data: {
      object: {
        action_id: action.id,
        action_type: action.actionType,
        agent_id: action.agentId,
        status: action.status,
        approved_by: action.approvedBy,
        approved_at: action.approvedAt,
      },
    },
  };
}

export function buildActionRejectedPayload(
  action: {
    id: string;
    actionType: string;
    agentId: string;
    status: string;
    rejectedBy: string | null;
    rejectedAt: string | null;
    errorMessage?: string | null;
  },
  apiVersion: string = CURRENT_API_VERSION,
): WebhookEvent {
  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "action.rejected",
    api_version: apiVersion,
    created_at: Math.floor(Date.now() / 1000),
    data: {
      object: {
        action_id: action.id,
        action_type: action.actionType,
        agent_id: action.agentId,
        status: action.status,
        rejected_by: action.rejectedBy,
        rejected_at: action.rejectedAt,
        reason: action.errorMessage ?? null,
      },
    },
  };
}

export function buildActionExpiredPayload(
  action: {
    id: string;
    actionType: string;
    agentId: string;
    status: string;
    expiredAt: string | null;
  },
  apiVersion: string = CURRENT_API_VERSION,
): WebhookEvent {
  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "action.expired",
    api_version: apiVersion,
    created_at: Math.floor(Date.now() / 1000),
    data: {
      object: {
        action_id: action.id,
        action_type: action.actionType,
        agent_id: action.agentId,
        status: action.status,
        expired_at: action.expiredAt,
      },
    },
  };
}

export function buildTestPingPayload(
  apiVersion: string = CURRENT_API_VERSION,
): WebhookEvent {
  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "test.ping",
    api_version: apiVersion,
    created_at: Math.floor(Date.now() / 1000),
    data: {
      object: {
        message: "Test webhook event",
      },
    },
  };
}

export function buildBudgetResetPayload(
  data: {
    budgetEntityType: string;
    budgetEntityId: string;
    budgetLimitMicrodollars: number;
    previousSpendMicrodollars: number;
    newPeriodStart: string;
    resetInterval: string;
  },
  apiVersion: string = CURRENT_API_VERSION,
): WebhookEvent {
  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "budget.reset",
    api_version: apiVersion,
    created_at: Math.floor(Date.now() / 1000),
    data: {
      object: {
        budget_entity_type: data.budgetEntityType,
        budget_entity_id: data.budgetEntityId,
        budget_limit_microdollars: data.budgetLimitMicrodollars,
        previous_spend_microdollars: data.previousSpendMicrodollars,
        new_period_start: data.newPeriodStart,
        reset_interval: data.resetInterval,
      },
    },
  };
}
