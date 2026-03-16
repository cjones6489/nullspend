import { describe, it, expect } from "vitest";
import {
  buildCostEventPayload,
  buildBudgetExceededPayload,
  buildThresholdPayload,
} from "../lib/webhook-events.js";

describe("buildCostEventPayload", () => {
  it("builds a valid cost_event.created payload", () => {
    const event = buildCostEventPayload({
      requestId: "req_123",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 200,
      costMicrodollars: 25000,
      durationMs: 1500,
      apiKeyId: "key_abc",
      eventType: "llm",
      sessionId: "session-1",
      upstreamDurationMs: 1400,
      toolCallsRequested: [{ name: "search", id: "call_1" }],
      toolDefinitionTokens: 800,
    });

    expect(event.type).toBe("cost_event.created");
    expect(event.id).toMatch(/^evt_/);
    expect(event.created_at).toBeTruthy();
    expect(event.data.request_id).toBe("req_123");
    expect(event.data.provider).toBe("openai");
    expect(event.data.model).toBe("gpt-4o");
    expect(event.data.input_tokens).toBe(1000);
    expect(event.data.output_tokens).toBe(500);
    expect(event.data.cached_input_tokens).toBe(200);
    expect(event.data.cost_microdollars).toBe(25000);
    expect(event.data.duration_ms).toBe(1500);
    expect(event.data.api_key_id).toBe("key_abc");
    expect(event.data.session_id).toBe("session-1");
    expect(event.data.upstream_duration_ms).toBe(1400);
    expect(event.data.tool_calls_requested).toEqual([{ name: "search", id: "call_1" }]);
    expect(event.data.tool_definition_tokens).toBe(800);
  });

  it("handles null optional fields", () => {
    const event = buildCostEventPayload({
      requestId: "req_456",
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      inputTokens: 500,
      outputTokens: 200,
      cachedInputTokens: 0,
      costMicrodollars: 3000,
      durationMs: null,
      apiKeyId: null,
      eventType: "llm",
    });

    expect(event.data.duration_ms).toBeNull();
    expect(event.data.api_key_id).toBeNull();
    expect(event.data.session_id).toBeNull();
    expect(event.data.upstream_duration_ms).toBeNull();
    expect(event.data.tool_calls_requested).toBeNull();
    expect(event.data.tool_definition_tokens).toBe(0);
  });

  it("generates unique event IDs", () => {
    const event1 = buildCostEventPayload({
      requestId: "req_1", provider: "openai", model: "gpt-4o",
      inputTokens: 100, outputTokens: 50, cachedInputTokens: 0,
      costMicrodollars: 1000, durationMs: 500, apiKeyId: "k1", eventType: "llm",
    });
    const event2 = buildCostEventPayload({
      requestId: "req_2", provider: "openai", model: "gpt-4o",
      inputTokens: 100, outputTokens: 50, cachedInputTokens: 0,
      costMicrodollars: 1000, durationMs: 500, apiKeyId: "k1", eventType: "llm",
    });
    expect(event1.id).not.toBe(event2.id);
  });
});

describe("buildBudgetExceededPayload", () => {
  it("builds a valid budget.exceeded payload", () => {
    const event = buildBudgetExceededPayload({
      budgetEntityType: "api_key",
      budgetEntityId: "key_xxx",
      budgetLimitMicrodollars: 50_000_000,
      budgetSpendMicrodollars: 48_200_000,
      estimatedRequestCostMicrodollars: 3_500_000,
      model: "gpt-4o",
      provider: "openai",
    });

    expect(event.type).toBe("budget.exceeded");
    expect(event.id).toMatch(/^evt_/);
    expect(event.data.budget_entity_type).toBe("api_key");
    expect(event.data.budget_entity_id).toBe("key_xxx");
    expect(event.data.budget_limit_microdollars).toBe(50_000_000);
    expect(event.data.budget_spend_microdollars).toBe(48_200_000);
    expect(event.data.estimated_request_cost_microdollars).toBe(3_500_000);
    expect(event.data.model).toBe("gpt-4o");
    expect(event.data.provider).toBe("openai");
    expect(event.data.blocked_at).toBeTruthy();
  });
});

describe("buildThresholdPayload", () => {
  it("builds a warning event for threshold < 90", () => {
    const event = buildThresholdPayload({
      budgetEntityType: "user",
      budgetEntityId: "user_abc",
      budgetLimitMicrodollars: 50_000_000,
      budgetSpendMicrodollars: 40_100_000,
      thresholdPercent: 80,
      triggeredByRequestId: "req_xyz",
    });

    expect(event.type).toBe("budget.threshold.warning");
    expect(event.data.threshold_percent).toBe(80);
    expect(event.data.budget_remaining_microdollars).toBe(9_900_000);
    expect(event.data.triggered_by_request_id).toBe("req_xyz");
  });

  it("builds a critical event for threshold >= 90", () => {
    const event = buildThresholdPayload({
      budgetEntityType: "api_key",
      budgetEntityId: "key_yyy",
      budgetLimitMicrodollars: 100_000_000,
      budgetSpendMicrodollars: 95_000_000,
      thresholdPercent: 95,
      triggeredByRequestId: "req_abc",
    });

    expect(event.type).toBe("budget.threshold.critical");
    expect(event.data.threshold_percent).toBe(95);
  });

  it("builds a critical event for exactly 90%", () => {
    const event = buildThresholdPayload({
      budgetEntityType: "user",
      budgetEntityId: "user_def",
      budgetLimitMicrodollars: 10_000_000,
      budgetSpendMicrodollars: 9_000_000,
      thresholdPercent: 90,
      triggeredByRequestId: "req_ghi",
    });

    expect(event.type).toBe("budget.threshold.critical");
  });

  it("builds a warning event for 50% threshold", () => {
    const event = buildThresholdPayload({
      budgetEntityType: "user",
      budgetEntityId: "user_jkl",
      budgetLimitMicrodollars: 20_000_000,
      budgetSpendMicrodollars: 10_000_000,
      thresholdPercent: 50,
      triggeredByRequestId: "req_mno",
    });

    expect(event.type).toBe("budget.threshold.warning");
  });
});
