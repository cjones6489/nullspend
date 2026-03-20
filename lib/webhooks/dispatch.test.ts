import { describe, expect, it, vi, afterEach } from "vitest";

const mockWhere = vi.fn().mockResolvedValue([]);
const mockSet = vi.fn().mockReturnValue({ where: mockWhere });

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    update: () => ({
      set: mockSet,
    }),
  })),
}));

import {
  buildCostEventWebhookPayload,
  buildActionCreatedPayload,
  buildActionApprovedPayload,
  buildActionRejectedPayload,
  buildActionExpiredPayload,
  buildTestPingPayload,
  buildBudgetResetPayload,
  dispatchToEndpoints,
  type WebhookEvent,
} from "./dispatch";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// buildCostEventWebhookPayload
// ---------------------------------------------------------------------------

describe("buildCostEventWebhookPayload", () => {
  it("produces correct webhook event shape", () => {
    const result = buildCostEventWebhookPayload({
      requestId: "req-1",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 10,
      costMicrodollars: 1500,
      durationMs: 200,
      eventType: "llm",
      toolName: null,
      toolServer: null,
      sessionId: "sess-1",
      apiKeyId: "key-1",
    });

    expect(result.type).toBe("cost_event.created");
    expect(result.id).toMatch(/^evt_/);
    expect(result.api_version).toBe("2026-04-01");
    expect(typeof result.created_at).toBe("number");
    expect(result.data.object.request_id).toBe("req-1");
    expect(result.data.object.provider).toBe("openai");
    expect(result.data.object.model).toBe("gpt-4o");
    expect(result.data.object.input_tokens).toBe(100);
    expect(result.data.object.output_tokens).toBe(50);
    expect(result.data.object.cached_input_tokens).toBe(10);
    expect(result.data.object.cost_microdollars).toBe(1500);
    expect(result.data.object.duration_ms).toBe(200);
    expect(result.data.object.event_type).toBe("llm");
    expect(result.data.object.session_id).toBe("sess-1");
    expect(result.data.object.api_key_id).toBe("key-1");
  });

  it("includes proxy-compatible fields (upstream_duration_ms, tool_calls_requested, tool_definition_tokens, created_at)", () => {
    const result = buildCostEventWebhookPayload({
      requestId: "req-2",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costMicrodollars: 0,
      durationMs: null,
      eventType: "custom",
      apiKeyId: null,
    });

    // These fields must exist for schema compatibility with the proxy
    expect(result.data.object).toHaveProperty("upstream_duration_ms", null);
    expect(result.data.object).toHaveProperty("tool_calls_requested", null);
    expect(result.data.object).toHaveProperty("tool_definition_tokens", 0);
    expect(result.data.object).toHaveProperty("created_at");
  });

  it("passes through upstreamDurationMs, toolCallsRequested, toolDefinitionTokens", () => {
    const result = buildCostEventWebhookPayload({
      requestId: "req-4",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 0,
      costMicrodollars: 1500,
      durationMs: 200,
      eventType: "llm",
      apiKeyId: "key-1",
      upstreamDurationMs: 180,
      toolCallsRequested: [{ name: "search", id: "call_1" }],
      toolDefinitionTokens: 500,
    });

    expect(result.data.object.upstream_duration_ms).toBe(180);
    expect(result.data.object.tool_calls_requested).toEqual([{ name: "search", id: "call_1" }]);
    expect(result.data.object.tool_definition_tokens).toBe(500);
  });

  it("nullifies missing optional fields", () => {
    const result = buildCostEventWebhookPayload({
      requestId: "req-3",
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costMicrodollars: 0,
      durationMs: null,
      eventType: "custom",
      apiKeyId: null,
    });

    expect(result.data.object.session_id).toBeNull();
    expect(result.data.object.tool_name).toBeNull();
    expect(result.data.object.tool_server).toBeNull();
    expect(result.data.object.api_key_id).toBeNull();
    expect(result.data.object.duration_ms).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Action lifecycle builders
// ---------------------------------------------------------------------------

describe("buildActionCreatedPayload", () => {
  it("produces correct action.created shape", () => {
    const result = buildActionCreatedPayload({
      id: "act-1",
      actionType: "http_post",
      agentId: "agent-1",
      status: "pending",
      payloadJson: { url: "https://example.com" },
      createdAt: "2026-03-19T00:00:00Z",
      expiresAt: "2026-03-20T00:00:00Z",
    });

    expect(result.type).toBe("action.created");
    expect(result.api_version).toBe("2026-04-01");
    expect(typeof result.created_at).toBe("number");
    expect(result.data.object.action_id).toBe("act-1");
    expect(result.data.object.action_type).toBe("http_post");
    expect(result.data.object.agent_id).toBe("agent-1");
    expect(result.data.object.status).toBe("pending");
    expect(result.data.object.payload).toEqual({ url: "https://example.com" });
    expect(result.data.object.created_at).toBe("2026-03-19T00:00:00Z");
    expect(result.data.object.expires_at).toBe("2026-03-20T00:00:00Z");
  });

  it("nullifies missing expiresAt", () => {
    const result = buildActionCreatedPayload({
      id: "act-2",
      actionType: "send_email",
      agentId: "agent-2",
      status: "pending",
      payloadJson: {},
      createdAt: "2026-03-19T00:00:00Z",
    });

    expect(result.data.object.expires_at).toBeNull();
  });
});

describe("buildActionApprovedPayload", () => {
  it("produces correct action.approved shape", () => {
    const result = buildActionApprovedPayload({
      id: "act-1",
      actionType: "http_post",
      agentId: "agent-1",
      status: "approved",
      approvedBy: "user-1",
      approvedAt: "2026-03-19T01:00:00Z",
    });

    expect(result.type).toBe("action.approved");
    expect(result.api_version).toBe("2026-04-01");
    expect(result.data.object.action_id).toBe("act-1");
    expect(result.data.object.approved_by).toBe("user-1");
    expect(result.data.object.approved_at).toBe("2026-03-19T01:00:00Z");
  });
});

describe("buildActionRejectedPayload", () => {
  it("produces correct action.rejected shape with reason", () => {
    const result = buildActionRejectedPayload({
      id: "act-1",
      actionType: "http_post",
      agentId: "agent-1",
      status: "rejected",
      rejectedBy: "user-1",
      rejectedAt: "2026-03-19T01:00:00Z",
      errorMessage: "Not authorized",
    });

    expect(result.type).toBe("action.rejected");
    expect(result.api_version).toBe("2026-04-01");
    expect(result.data.object.action_id).toBe("act-1");
    expect(result.data.object.rejected_by).toBe("user-1");
    expect(result.data.object.rejected_at).toBe("2026-03-19T01:00:00Z");
    expect(result.data.object.reason).toBe("Not authorized");
  });

  it("nullifies missing errorMessage", () => {
    const result = buildActionRejectedPayload({
      id: "act-2",
      actionType: "send_email",
      agentId: "agent-2",
      status: "rejected",
      rejectedBy: null,
      rejectedAt: null,
    });

    expect(result.data.object.reason).toBeNull();
  });
});

describe("buildActionExpiredPayload", () => {
  it("produces correct action.expired shape", () => {
    const result = buildActionExpiredPayload({
      id: "act-1",
      actionType: "http_post",
      agentId: "agent-1",
      status: "expired",
      expiredAt: "2026-03-20T00:00:00Z",
    });

    expect(result.type).toBe("action.expired");
    expect(result.api_version).toBe("2026-04-01");
    expect(result.data.object.action_id).toBe("act-1");
    expect(result.data.object.expired_at).toBe("2026-03-20T00:00:00Z");
  });
});

describe("buildTestPingPayload", () => {
  it("produces correct test.ping shape", () => {
    const result = buildTestPingPayload();

    expect(result.type).toBe("test.ping");
    expect(result.id).toMatch(/^evt_/);
    expect(result.api_version).toBe("2026-04-01");
    expect(typeof result.created_at).toBe("number");
    expect(result.data.object.message).toBe("Test webhook event");
  });
});

describe("buildBudgetResetPayload", () => {
  it("produces correct budget.reset shape", () => {
    const result = buildBudgetResetPayload({
      budgetEntityType: "user",
      budgetEntityId: "user-1",
      budgetLimitMicrodollars: 50_000_000,
      previousSpendMicrodollars: 45_000_000,
      newPeriodStart: "2026-04-01T00:00:00Z",
      resetInterval: "monthly",
    });

    expect(result.type).toBe("budget.reset");
    expect(result.api_version).toBe("2026-04-01");
    expect(typeof result.created_at).toBe("number");
    expect(result.data.object.budget_entity_type).toBe("user");
    expect(result.data.object.budget_entity_id).toBe("user-1");
    expect(result.data.object.budget_limit_microdollars).toBe(50_000_000);
    expect(result.data.object.previous_spend_microdollars).toBe(45_000_000);
    expect(result.data.object.new_period_start).toBe("2026-04-01T00:00:00Z");
    expect(result.data.object.reset_interval).toBe("monthly");
  });
});

// ---------------------------------------------------------------------------
// Cross-builder shape compatibility
// ---------------------------------------------------------------------------

describe("cross-builder shape compatibility", () => {
  // Shared input that exercises all optional fields
  const sharedInput = {
    requestId: "req-1",
    provider: "openai",
    model: "gpt-4o",
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: 10,
    costMicrodollars: 1500,
    durationMs: 200,
    eventType: "llm",
    toolName: "search",
    toolServer: "mcp-server",
    sessionId: "sess-1",
    apiKeyId: "key-1",
    upstreamDurationMs: 180,
    toolCallsRequested: [{ name: "search", id: "call_1" }] as { name: string; id: string }[],
    toolDefinitionTokens: 500,
    source: "proxy",
    tags: { project: "alpha", env: "prod" },
  };

  it("proxy and dashboard cost_event.created builders produce identical data.object key sets", async () => {
    // Dashboard builder
    const dashboardEvent = buildCostEventWebhookPayload(sharedInput);
    const dashboardKeys = Object.keys(dashboardEvent.data.object).sort();

    // Proxy builder — import dynamically to get the actual proxy output
    // Since we can't import from apps/proxy in dashboard tests, we hardcode
    // the expected key set that the proxy builder MUST produce.
    // If proxy adds/removes a key, this test must be updated in lockstep.
    const proxyExpectedKeys = [
      "api_key_id",
      "cached_input_tokens",
      "cost_microdollars",
      "created_at",
      "duration_ms",
      "event_type",
      "input_tokens",
      "model",
      "output_tokens",
      "provider",
      "request_id",
      "session_id",
      "source",
      "tags",
      "tool_calls_requested",
      "tool_definition_tokens",
      "tool_name",
      "tool_server",
      "upstream_duration_ms",
    ];

    // Bidirectional: dashboard must have ALL proxy keys
    for (const key of proxyExpectedKeys) {
      expect(dashboardKeys, `dashboard missing proxy key: ${key}`).toContain(key);
    }

    // Bidirectional: dashboard must NOT have EXTRA keys beyond proxy
    for (const key of dashboardKeys) {
      expect(proxyExpectedKeys, `dashboard has extra key not in proxy: ${key}`).toContain(key);
    }

    // Belt-and-suspenders: exact length match
    expect(dashboardKeys).toHaveLength(proxyExpectedKeys.length);
  });
});

// ---------------------------------------------------------------------------
// dispatchToEndpoints
// ---------------------------------------------------------------------------

describe("dispatchToEndpoints", () => {
  const mockEvent: WebhookEvent = {
    id: "evt_test",
    type: "cost_event.created",
    api_version: "2026-04-01",
    created_at: 1710547200,
    data: { object: { test: true } },
  };

  it("sends POST to each matching endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await dispatchToEndpoints(
      [
        { id: "ep-1", url: "https://a.com/hook", signingSecret: "s1", previousSigningSecret: null, secretRotatedAt: null, eventTypes: [], apiVersion: "2026-04-01" },
        { id: "ep-2", url: "https://b.com/hook", signingSecret: "s2", previousSigningSecret: null, secretRotatedAt: null, eventTypes: [], apiVersion: "2026-04-01" },
      ],
      mockEvent,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://a.com/hook");
    expect(fetchSpy.mock.calls[1][0]).toBe("https://b.com/hook");
  });

  it("skips endpoints that do not match event type", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await dispatchToEndpoints(
      [
        { id: "ep-1", url: "https://a.com/hook", signingSecret: "s1", previousSigningSecret: null, secretRotatedAt: null, eventTypes: ["budget.exceeded"], apiVersion: "2026-04-01" },
        { id: "ep-2", url: "https://b.com/hook", signingSecret: "s2", previousSigningSecret: null, secretRotatedAt: null, eventTypes: [], apiVersion: "2026-04-01" }, // all events
      ],
      mockEvent,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://b.com/hook");
  });

  it("includes signature headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await dispatchToEndpoints(
      [{ id: "ep-1", url: "https://a.com/hook", signingSecret: "secret", previousSigningSecret: null, secretRotatedAt: null, eventTypes: [], apiVersion: "2026-04-01" }],
      mockEvent,
    );

    const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers["X-NullSpend-Signature"]).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
    expect(headers["X-NullSpend-Webhook-Id"]).toBe("evt_test");
    expect(headers["User-Agent"]).toBe("NullSpend-Webhooks/1.0");
  });

  it("does not throw on fetch failure — logs and continues", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(new Response("ok"));

    // Should not throw
    await dispatchToEndpoints(
      [
        { id: "ep-1", url: "https://down.com/hook", signingSecret: "s1", previousSigningSecret: null, secretRotatedAt: null, eventTypes: [], apiVersion: "2026-04-01" },
        { id: "ep-2", url: "https://up.com/hook", signingSecret: "s2", previousSigningSecret: null, secretRotatedAt: null, eventTypes: [], apiVersion: "2026-04-01" },
      ],
      mockEvent,
    );

    // Second endpoint was still called despite first failure
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("produces dual signature header when previous secret is active", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await dispatchToEndpoints(
      [{
        id: "ep-1",
        url: "https://a.com/hook",
        signingSecret: "current_secret",
        previousSigningSecret: "old_secret",
        secretRotatedAt: new Date(), // just rotated
        eventTypes: [],
        apiVersion: "2026-04-01",
      }],
      mockEvent,
    );

    const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
    // Should have two v1 values
    expect(headers["X-NullSpend-Signature"]).toMatch(/^t=\d+,v1=[0-9a-f]+,v1=[0-9a-f]+$/);
  });

  it("produces single signature header when no previous secret", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await dispatchToEndpoints(
      [{
        id: "ep-1",
        url: "https://a.com/hook",
        signingSecret: "current_secret",
        previousSigningSecret: null,
        secretRotatedAt: null,
        eventTypes: [],
        apiVersion: "2026-04-01",
      }],
      mockEvent,
    );

    const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers["X-NullSpend-Signature"]).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
    // Should NOT have two v1 values
    expect(headers["X-NullSpend-Signature"]).not.toMatch(/,v1=.*,v1=/);
  });

  it("produces single signature when rotation window expired", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await dispatchToEndpoints(
      [{
        id: "ep-1",
        url: "https://a.com/hook",
        signingSecret: "current_secret",
        previousSigningSecret: "old_secret",
        secretRotatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
        eventTypes: [],
        apiVersion: "2026-04-01",
      }],
      mockEvent,
    );

    const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers["X-NullSpend-Signature"]).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
    expect(headers["X-NullSpend-Signature"]).not.toMatch(/,v1=.*,v1=/);
  });

  it("does nothing for empty endpoints", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await dispatchToEndpoints([], mockEvent);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fires lazy expiry for endpoints with expired rotation (fire-and-forget)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    mockSet.mockClear();
    mockWhere.mockClear();

    await dispatchToEndpoints(
      [{
        id: "ep-expired",
        url: "https://a.com/hook",
        signingSecret: "current",
        previousSigningSecret: "old",
        secretRotatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25h ago
        eventTypes: [],
        apiVersion: "2026-04-01",
      }],
      mockEvent,
    );

    // Give fire-and-forget microtask a chance to run
    await new Promise((r) => setTimeout(r, 10));

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        previousSigningSecret: null,
        secretRotatedAt: null,
      }),
    );
  });

  it("does NOT fire lazy expiry for endpoints within rotation window", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    mockSet.mockClear();

    await dispatchToEndpoints(
      [{
        id: "ep-active",
        url: "https://a.com/hook",
        signingSecret: "current",
        previousSigningSecret: "old",
        secretRotatedAt: new Date(), // just rotated
        eventTypes: [],
        apiVersion: "2026-04-01",
      }],
      mockEvent,
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(mockSet).not.toHaveBeenCalled();
  });
});
