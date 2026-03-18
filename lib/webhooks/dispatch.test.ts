import { describe, expect, it, vi, afterEach } from "vitest";

import {
  buildCostEventWebhookPayload,
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
    expect(result.created_at).toBeTruthy();
    expect(result.data.request_id).toBe("req-1");
    expect(result.data.provider).toBe("openai");
    expect(result.data.model).toBe("gpt-4o");
    expect(result.data.input_tokens).toBe(100);
    expect(result.data.output_tokens).toBe(50);
    expect(result.data.cached_input_tokens).toBe(10);
    expect(result.data.cost_microdollars).toBe(1500);
    expect(result.data.duration_ms).toBe(200);
    expect(result.data.event_type).toBe("llm");
    expect(result.data.session_id).toBe("sess-1");
    expect(result.data.api_key_id).toBe("key-1");
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
    expect(result.data).toHaveProperty("upstream_duration_ms", null);
    expect(result.data).toHaveProperty("tool_calls_requested", null);
    expect(result.data).toHaveProperty("tool_definition_tokens", 0);
    expect(result.data).toHaveProperty("created_at");
    expect(result.data.created_at).toBe(result.created_at);
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

    expect(result.data.session_id).toBeNull();
    expect(result.data.tool_name).toBeNull();
    expect(result.data.tool_server).toBeNull();
    expect(result.data.api_key_id).toBeNull();
    expect(result.data.duration_ms).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dispatchToEndpoints
// ---------------------------------------------------------------------------

describe("dispatchToEndpoints", () => {
  const mockEvent: WebhookEvent = {
    id: "evt_test",
    type: "cost_event.created",
    created_at: "2026-03-18T00:00:00Z",
    data: { test: true },
  };

  it("sends POST to each matching endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await dispatchToEndpoints(
      [
        { id: "ep-1", url: "https://a.com/hook", signingSecret: "s1", eventTypes: [] },
        { id: "ep-2", url: "https://b.com/hook", signingSecret: "s2", eventTypes: [] },
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
        { id: "ep-1", url: "https://a.com/hook", signingSecret: "s1", eventTypes: ["budget.exceeded"] },
        { id: "ep-2", url: "https://b.com/hook", signingSecret: "s2", eventTypes: [] }, // all events
      ],
      mockEvent,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://b.com/hook");
  });

  it("includes signature headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));

    await dispatchToEndpoints(
      [{ id: "ep-1", url: "https://a.com/hook", signingSecret: "secret", eventTypes: [] }],
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
        { id: "ep-1", url: "https://down.com/hook", signingSecret: "s1", eventTypes: [] },
        { id: "ep-2", url: "https://up.com/hook", signingSecret: "s2", eventTypes: [] },
      ],
      mockEvent,
    );

    // Second endpoint was still called despite first failure
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("does nothing for empty endpoints", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await dispatchToEndpoints([], mockEvent);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
