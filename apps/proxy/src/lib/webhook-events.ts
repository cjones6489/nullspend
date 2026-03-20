// SYNC: Dashboard WebhookEvent interface in lib/webhooks/dispatch.ts must match this shape

export const CURRENT_API_VERSION = "2026-04-01";

export type WebhookEventType =
  | "cost_event.created"
  | "budget.threshold.warning"
  | "budget.threshold.critical"
  | "budget.exceeded"
  | "budget.reset"
  | "request.blocked"
  | "action.created"
  | "action.approved"
  | "action.rejected"
  | "action.expired"
  | "velocity.exceeded"
  | "velocity.recovered"
  | "test.ping";

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  api_version: string;
  created_at: number;
  data: { object: Record<string, unknown> };
}

interface CostEventData {
  requestId: string;
  createdAt?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costMicrodollars: number;
  durationMs: number | null;
  apiKeyId: string | null;
  eventType: string;
  toolName?: string | null;
  toolServer?: string | null;
  upstreamDurationMs?: number;
  sessionId?: string | null;
  toolCallsRequested?: { name: string; id: string }[] | null;
  toolDefinitionTokens?: number;
  source?: string;
  tags?: Record<string, string>;
}

export function buildCostEventPayload(
  costEvent: CostEventData,
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
        created_at: costEvent.createdAt ?? new Date().toISOString(),
      },
    },
  };
}

interface BudgetExceededData {
  budgetEntityType: string;
  budgetEntityId: string;
  budgetLimitMicrodollars: number;
  budgetSpendMicrodollars: number;
  estimatedRequestCostMicrodollars: number;
  model: string;
  provider: string;
}

export function buildBudgetExceededPayload(
  data: BudgetExceededData,
  apiVersion: string = CURRENT_API_VERSION,
): WebhookEvent {
  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "budget.exceeded",
    api_version: apiVersion,
    created_at: Math.floor(Date.now() / 1000),
    data: {
      object: {
        budget_entity_type: data.budgetEntityType,
        budget_entity_id: data.budgetEntityId,
        budget_limit_microdollars: data.budgetLimitMicrodollars,
        budget_spend_microdollars: data.budgetSpendMicrodollars,
        estimated_request_cost_microdollars: data.estimatedRequestCostMicrodollars,
        model: data.model,
        provider: data.provider,
        blocked_at: new Date().toISOString(),
      },
    },
  };
}

interface ThresholdData {
  budgetEntityType: string;
  budgetEntityId: string;
  budgetLimitMicrodollars: number;
  budgetSpendMicrodollars: number;
  thresholdPercent: number;
  triggeredByRequestId: string;
}

export function buildThresholdPayload(
  data: ThresholdData,
  apiVersion: string = CURRENT_API_VERSION,
): WebhookEvent {
  const type: WebhookEventType = data.thresholdPercent >= 90
    ? "budget.threshold.critical"
    : "budget.threshold.warning";

  return {
    id: `evt_${crypto.randomUUID()}`,
    type,
    api_version: apiVersion,
    created_at: Math.floor(Date.now() / 1000),
    data: {
      object: {
        budget_entity_type: data.budgetEntityType,
        budget_entity_id: data.budgetEntityId,
        budget_limit_microdollars: data.budgetLimitMicrodollars,
        budget_spend_microdollars: data.budgetSpendMicrodollars,
        threshold_percent: data.thresholdPercent,
        budget_remaining_microdollars:
          data.budgetLimitMicrodollars - data.budgetSpendMicrodollars,
        triggered_by_request_id: data.triggeredByRequestId,
      },
    },
  };
}

interface BudgetResetData {
  budgetEntityType: string;
  budgetEntityId: string;
  budgetLimitMicrodollars: number;
  previousSpendMicrodollars: number;
  newPeriodStart: string;
  resetInterval: string;
}

export function buildBudgetResetPayload(
  data: BudgetResetData,
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

interface RequestBlockedData {
  reason: "budget" | "rate_limit" | "policy";
  model: string;
  provider: string;
  apiKeyId: string | null;
  details: string | null;
}

export function buildRequestBlockedPayload(
  data: RequestBlockedData,
  apiVersion: string = CURRENT_API_VERSION,
): WebhookEvent {
  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "request.blocked",
    api_version: apiVersion,
    created_at: Math.floor(Date.now() / 1000),
    data: {
      object: {
        reason: data.reason,
        model: data.model,
        provider: data.provider,
        api_key_id: data.apiKeyId,
        details: data.details,
      },
    },
  };
}

interface VelocityExceededData {
  budgetEntityType: string;
  budgetEntityId: string;
  velocityLimitMicrodollars: number;
  velocityWindowSeconds: number;
  velocityCurrentMicrodollars: number;
  cooldownSeconds: number;
  model: string;
  provider: string;
}

export function buildVelocityExceededPayload(
  data: VelocityExceededData,
  apiVersion: string = CURRENT_API_VERSION,
): WebhookEvent {
  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "velocity.exceeded",
    api_version: apiVersion,
    created_at: Math.floor(Date.now() / 1000),
    data: {
      object: {
        budget_entity_type: data.budgetEntityType,
        budget_entity_id: data.budgetEntityId,
        velocity_limit_microdollars: data.velocityLimitMicrodollars,
        velocity_window_seconds: data.velocityWindowSeconds,
        velocity_current_microdollars: data.velocityCurrentMicrodollars,
        cooldown_seconds: data.cooldownSeconds,
        model: data.model,
        provider: data.provider,
        blocked_at: new Date().toISOString(),
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
