export type WebhookEventType =
  | "cost_event.created"
  | "budget.threshold.warning"
  | "budget.threshold.critical"
  | "budget.exceeded"
  | "request.blocked"
  | "request.blocked.budget";

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  created_at: string;
  data: Record<string, unknown>;
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
}

export function buildCostEventPayload(
  costEvent: CostEventData,
): WebhookEvent {
  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "cost_event.created",
    created_at: new Date().toISOString(),
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
      upstream_duration_ms: costEvent.upstreamDurationMs ?? null,
      session_id: costEvent.sessionId ?? null,
      tool_calls_requested: costEvent.toolCallsRequested ?? null,
      tool_definition_tokens: costEvent.toolDefinitionTokens ?? 0,
      api_key_id: costEvent.apiKeyId,
      created_at: costEvent.createdAt ?? new Date().toISOString(),
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
): WebhookEvent {
  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "budget.exceeded",
    created_at: new Date().toISOString(),
    data: {
      budget_entity_type: data.budgetEntityType,
      budget_entity_id: data.budgetEntityId,
      budget_limit_microdollars: data.budgetLimitMicrodollars,
      budget_spend_microdollars: data.budgetSpendMicrodollars,
      estimated_request_cost_microdollars: data.estimatedRequestCostMicrodollars,
      model: data.model,
      provider: data.provider,
      blocked_at: new Date().toISOString(),
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
): WebhookEvent {
  const type: WebhookEventType = data.thresholdPercent >= 90
    ? "budget.threshold.critical"
    : "budget.threshold.warning";

  return {
    id: `evt_${crypto.randomUUID()}`,
    type,
    created_at: new Date().toISOString(),
    data: {
      budget_entity_type: data.budgetEntityType,
      budget_entity_id: data.budgetEntityId,
      budget_limit_microdollars: data.budgetLimitMicrodollars,
      budget_spend_microdollars: data.budgetSpendMicrodollars,
      threshold_percent: data.thresholdPercent,
      budget_remaining_microdollars:
        data.budgetLimitMicrodollars - data.budgetSpendMicrodollars,
      triggered_by_request_id: data.triggeredByRequestId,
    },
  };
}
