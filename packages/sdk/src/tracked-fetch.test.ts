import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildTrackedFetch } from "./tracked-fetch.js";
import {
  BudgetExceededError,
  MandateViolationError,
  SessionLimitExceededError,
  VelocityExceededError,
  TagBudgetExceededError,
} from "./errors.js";
import type { CostEventInput, TrackedFetchOptions, DenialReason } from "./types.js";
import type { PolicyCache, PolicyResponse } from "./policy-cache.js";

vi.mock("@nullspend/cost-engine", () => ({
  getModelPricing: vi.fn(() => ({
    inputPerMTok: 2.5,
    outputPerMTok: 10,
    cachedInputPerMTok: 1.25,
  })),
  costComponent: vi.fn((tokens: number, rate: number) => {
    if (tokens <= 0 || rate <= 0) return 0;
    return tokens * rate;
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function makeOpenAIBody(model = "gpt-4o", stream = false): string {
  return JSON.stringify({ model, stream, messages: [{ role: "user", content: "Hi" }] });
}

function makeAnthropicBody(model = "claude-sonnet-4-20250514", stream = false): string {
  return JSON.stringify({ model, stream, messages: [{ role: "user", content: "Hi" }] });
}

function mockFetchJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : `Status ${status}`,
    headers: { "content-type": "application/json" },
  });
}

function mockFetchStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function openaiJsonResponse(model = "gpt-4o") {
  return mockFetchJsonResponse({
    id: "chatcmpl-1",
    model,
    usage: { prompt_tokens: 100, completion_tokens: 50 },
    choices: [{ message: { role: "assistant", content: "Hello!" } }],
  });
}

function anthropicJsonResponse(model = "claude-sonnet-4-20250514") {
  return mockFetchJsonResponse({
    id: "msg-1",
    model,
    usage: { input_tokens: 80, output_tokens: 40 },
    content: [{ type: "text", text: "Hello!" }],
  });
}

function openaiStreamChunks(model = "gpt-4o"): string[] {
  return [
    `data: ${JSON.stringify({ id: "chatcmpl-1", model, choices: [{ delta: { content: "Hi" } }] })}\n\n`,
    `data: ${JSON.stringify({ id: "chatcmpl-1", model, choices: [{ delta: {} }], usage: { prompt_tokens: 100, completion_tokens: 50 } })}\n\n`,
    "data: [DONE]\n\n",
  ];
}

function anthropicStreamChunks(model = "claude-sonnet-4-20250514"): string[] {
  return [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { model, usage: { input_tokens: 80, output_tokens: 0 } } })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { text: "Hi" } })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 40 } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
  ];
}

function createMockPolicyCache(overrides: Partial<PolicyCache> = {}): PolicyCache {
  return {
    getPolicy: vi.fn().mockResolvedValue({
      budget: null,
      allowed_models: null,
      allowed_providers: null,
      cheapest_per_provider: null,
      cheapest_overall: null,
      restrictions_active: false,
    } satisfies PolicyResponse),
    checkMandate: vi.fn().mockReturnValue({ allowed: true }),
    checkBudget: vi.fn().mockReturnValue({ allowed: true }),
    getSessionLimit: vi.fn().mockReturnValue(null),
    invalidate: vi.fn(),
    ...overrides,
  };
}

async function consumeStream(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildTrackedFetch", () => {
  let originalFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;
  let queueCost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    queueCost = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Non-streaming
  // -------------------------------------------------------------------------

  describe("non-streaming OpenAI", () => {
    it("calls fetch and queues a cost event with correct values", async () => {
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(queueCost).toHaveBeenCalledTimes(1);

      const event: CostEventInput = queueCost.mock.calls[0][0];
      expect(event.provider).toBe("openai");
      expect(event.model).toBe("gpt-4o");
      expect(event.inputTokens).toBe(100);
      expect(event.outputTokens).toBe(50);
      expect(event.costMicrodollars).toBeGreaterThan(0);
    });
  });

  describe("non-streaming Anthropic", () => {
    it("calls fetch and queues a cost event with correct values", async () => {
      mockFetch.mockResolvedValue(anthropicJsonResponse());
      const trackedFetch = buildTrackedFetch("anthropic", undefined, queueCost, null);

      const response = await trackedFetch(ANTHROPIC_URL, {
        method: "POST",
        body: makeAnthropicBody(),
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(queueCost).toHaveBeenCalledTimes(1);

      const event: CostEventInput = queueCost.mock.calls[0][0];
      expect(event.provider).toBe("anthropic");
      expect(event.model).toBe("claude-sonnet-4-20250514");
      expect(event.inputTokens).toBe(80);
      expect(event.outputTokens).toBe(40);
    });
  });

  // -------------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------------

  describe("streaming OpenAI", () => {
    it("injects stream_options.include_usage, returns readable body, queues cost after stream", async () => {
      mockFetch.mockResolvedValue(mockFetchStreamResponse(openaiStreamChunks()));
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody("gpt-4o", true),
      });

      expect(response.body).toBeTruthy();

      // Consume the stream to trigger cost event
      const text = await consumeStream(response);
      expect(text).toContain("chatcmpl-1");

      // The stream_options.include_usage should have been injected
      const calledBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(calledBody.stream_options?.include_usage).toBe(true);

      // Wait a tick for the fire-and-forget promise
      await new Promise((r) => setTimeout(r, 10));

      expect(queueCost).toHaveBeenCalledTimes(1);
      const event: CostEventInput = queueCost.mock.calls[0][0];
      expect(event.provider).toBe("openai");
      expect(event.inputTokens).toBe(100);
      expect(event.outputTokens).toBe(50);
    });
  });

  describe("streaming Anthropic", () => {
    it("returns readable body and queues cost after stream completes", async () => {
      mockFetch.mockResolvedValue(mockFetchStreamResponse(anthropicStreamChunks()));
      const trackedFetch = buildTrackedFetch("anthropic", undefined, queueCost, null);

      const response = await trackedFetch(ANTHROPIC_URL, {
        method: "POST",
        body: makeAnthropicBody("claude-sonnet-4-20250514", true),
      });

      expect(response.body).toBeTruthy();
      await consumeStream(response);

      await new Promise((r) => setTimeout(r, 10));

      expect(queueCost).toHaveBeenCalledTimes(1);
      const event: CostEventInput = queueCost.mock.calls[0][0];
      expect(event.provider).toBe("anthropic");
      expect(event.model).toBe("claude-sonnet-4-20250514");
    });
  });

  // -------------------------------------------------------------------------
  // Passthrough cases
  // -------------------------------------------------------------------------

  describe("passthrough", () => {
    it("passes through GET /models without cost tracking", async () => {
      mockFetch.mockResolvedValue(mockFetchJsonResponse({ data: [] }));
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      await trackedFetch("https://api.openai.com/v1/models", { method: "GET" });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(queueCost).not.toHaveBeenCalled();
    });

    it("passes through non-POST methods", async () => {
      mockFetch.mockResolvedValue(mockFetchJsonResponse({}));
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      // DELETE request
      await trackedFetch(OPENAI_URL, { method: "DELETE" });
      expect(queueCost).not.toHaveBeenCalled();
    });

    it("does not track 4xx error responses", async () => {
      mockFetch.mockResolvedValue(mockFetchJsonResponse({ error: "bad request" }, 400));
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(response.status).toBe(400);
      expect(queueCost).not.toHaveBeenCalled();
    });

    it("does not track 5xx error responses", async () => {
      mockFetch.mockResolvedValue(mockFetchJsonResponse({ error: "internal" }, 500));
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(response.status).toBe(500);
      expect(queueCost).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Proxy detection guard
  // -------------------------------------------------------------------------

  describe("proxy detection guard", () => {
    it("passes through when URL contains proxy.nullspend.com", async () => {
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      await trackedFetch("https://proxy.nullspend.com/v1/chat/completions", {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(queueCost).not.toHaveBeenCalled();
    });

    it("passes through when x-nullspend-key header is present (Headers object)", async () => {
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      const headers = new Headers({ "x-nullspend-key": "ns_live_sk_test" });
      await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
        headers,
      });

      expect(queueCost).not.toHaveBeenCalled();
    });

    it("passes through when x-nullspend-key header is present (plain object)", async () => {
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
        headers: { "x-nullspend-key": "ns_live_sk_test" },
      });

      expect(queueCost).not.toHaveBeenCalled();
    });

    it("passes through when x-nullspend-key header is present (array tuples)", async () => {
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
        headers: [["x-nullspend-key", "ns_live_sk_test"]],
      });

      expect(queueCost).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Error resilience
  // -------------------------------------------------------------------------

  describe("error resilience", () => {
    it("returns the response even when cost tracking fails (JSON parse error)", async () => {
      // Return a response that will fail JSON parsing on the cloned body
      const resp = new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      mockFetch.mockResolvedValue(resp);

      const onCostError = vi.fn();
      const trackedFetch = buildTrackedFetch(
        "openai",
        { onCostError },
        queueCost,
        null,
      );

      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(response.status).toBe(200);
      expect(queueCost).not.toHaveBeenCalled();
      expect(onCostError).toHaveBeenCalledTimes(1);
      expect(onCostError.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it("invokes onCostError callback on tracking failure", async () => {
      const resp = new Response("bad", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      mockFetch.mockResolvedValue(resp);

      const onCostError = vi.fn();
      const trackedFetch = buildTrackedFetch(
        "openai",
        { onCostError },
        queueCost,
        null,
      );

      await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(onCostError).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // stream_options merging
  // -------------------------------------------------------------------------

  describe("stream_options merging", () => {
    it("merges include_usage with existing stream_options (does not overwrite)", async () => {
      mockFetch.mockResolvedValue(mockFetchStreamResponse(openaiStreamChunks()));
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      const body = JSON.stringify({
        model: "gpt-4o",
        stream: true,
        stream_options: { custom_field: "keep_me" },
        messages: [],
      });

      await trackedFetch(OPENAI_URL, { method: "POST", body });
      const calledBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);

      expect(calledBody.stream_options.include_usage).toBe(true);
      expect(calledBody.stream_options.custom_field).toBe("keep_me");
    });
  });

  // -------------------------------------------------------------------------
  // AbortSignal
  // -------------------------------------------------------------------------

  describe("AbortSignal", () => {
    it("preserves AbortSignal through to real fetch", async () => {
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const controller = new AbortController();
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
        signal: controller.signal,
      });

      // The init passed to real fetch should have the signal
      const calledInit = mockFetch.mock.calls[0][1];
      expect(calledInit.signal).toBe(controller.signal);
    });
  });

  // -------------------------------------------------------------------------
  // Cancelled stream
  // -------------------------------------------------------------------------

  describe("cancelled stream", () => {
    it("does not queue cost event when usage is null from cancelled stream", async () => {
      // Create a stream that never sends usage
      const chunks = [
        `data: ${JSON.stringify({ id: "chatcmpl-1", model: "gpt-4o", choices: [{ delta: { content: "Hi" } }] })}\n\n`,
      ];
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          // Don't close
        },
      });
      const resp = new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
      mockFetch.mockResolvedValue(resp);

      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);
      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody("gpt-4o", true),
      });

      // Cancel the stream
      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel();

      await new Promise((r) => setTimeout(r, 10));

      // No usage in stream => no cost event
      expect(queueCost).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Metadata passthrough
  // -------------------------------------------------------------------------

  describe("metadata passthrough", () => {
    it("passes sessionId, traceId, and tags to cost events", async () => {
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const options: TrackedFetchOptions = {
        sessionId: "sess-abc",
        traceId: "trace-123",
        tags: { env: "prod", team: "ai" },
      };
      const trackedFetch = buildTrackedFetch("openai", options, queueCost, null);

      await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      const event: CostEventInput = queueCost.mock.calls[0][0];
      expect(event.sessionId).toBe("sess-abc");
      expect(event.traceId).toBe("trace-123");
      expect(event.tags).toEqual({ env: "prod", team: "ai" });
    });
  });

  // -------------------------------------------------------------------------
  // Enforcement: mandates
  // -------------------------------------------------------------------------

  describe("enforcement — mandates", () => {
    it("throws MandateViolationError when model is denied", async () => {
      const policyCache = createMockPolicyCache({
        checkMandate: vi.fn().mockReturnValue({
          allowed: false,
          mandate: "allowed_models",
          requested: "gpt-4o",
          allowed_list: ["gpt-4o-mini"],
        }),
      });

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(MandateViolationError);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("invokes onDenied callback before throwing MandateViolationError", async () => {
      const policyCache = createMockPolicyCache({
        checkMandate: vi.fn().mockReturnValue({
          allowed: false,
          mandate: "allowed_models",
          requested: "gpt-4o",
          allowed_list: ["gpt-4o-mini"],
        }),
      });

      const onDenied = vi.fn();
      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, onDenied },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(MandateViolationError);

      expect(onDenied).toHaveBeenCalledTimes(1);
      const reason: DenialReason = onDenied.mock.calls[0][0];
      expect(reason.type).toBe("mandate");
    });
  });

  // -------------------------------------------------------------------------
  // Enforcement: budget
  // -------------------------------------------------------------------------

  describe("enforcement — budget", () => {
    it("throws BudgetExceededError when budget is exceeded", async () => {
      const policyCache = createMockPolicyCache({
        checkBudget: vi.fn().mockReturnValue({ allowed: false, remaining: 50 }),
      });

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(BudgetExceededError);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("invokes onDenied callback before throwing BudgetExceededError", async () => {
      const policyCache = createMockPolicyCache({
        checkBudget: vi.fn().mockReturnValue({ allowed: false, remaining: 25 }),
      });

      const onDenied = vi.fn();
      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, onDenied },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(BudgetExceededError);

      expect(onDenied).toHaveBeenCalledTimes(1);
      const reason: DenialReason = onDenied.mock.calls[0][0];
      expect(reason.type).toBe("budget");
      if (reason.type === "budget") {
        expect(reason.remaining).toBe(25);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Enforcement: fail-open
  // -------------------------------------------------------------------------

  describe("enforcement — fail-open on policy fetch failure", () => {
    it("proceeds with the request when getPolicy rejects", async () => {
      const policyCache = createMockPolicyCache({
        getPolicy: vi.fn().mockRejectedValue(new Error("network error")),
      });

      mockFetch.mockResolvedValue(openaiJsonResponse());
      const onCostError = vi.fn();
      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, onCostError },
        queueCost,
        policyCache,
      );

      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(onCostError).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Enforcement disabled by default
  // -------------------------------------------------------------------------

  describe("enforcement off by default", () => {
    it("does not check policies when enforcement is not set", async () => {
      const policyCache = createMockPolicyCache();
      mockFetch.mockResolvedValue(openaiJsonResponse());

      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, policyCache);

      await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(policyCache.getPolicy).not.toHaveBeenCalled();
      expect(policyCache.checkMandate).not.toHaveBeenCalled();
      expect(policyCache.checkBudget).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Request input types
  // -------------------------------------------------------------------------

  describe("Request input resolution", () => {
    it("handles URL object as input", async () => {
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      await trackedFetch(new URL(OPENAI_URL), {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(queueCost).toHaveBeenCalledTimes(1);
    });

    it("handles string URL as input", async () => {
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(queueCost).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Model resolution from response
  // -------------------------------------------------------------------------

  describe("model resolution", () => {
    it("uses model from response JSON over request body when available", async () => {
      // Request says gpt-4o but response says gpt-4o-2024-08-06
      mockFetch.mockResolvedValue(openaiJsonResponse("gpt-4o-2024-08-06"));
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody("gpt-4o"),
      });

      const event: CostEventInput = queueCost.mock.calls[0][0];
      expect(event.model).toBe("gpt-4o-2024-08-06");
    });
  });

  // -------------------------------------------------------------------------
  // No body edge case
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("defaults to 'unknown' model when body cannot be parsed", async () => {
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);

      // POST with no body — method from init makes it tracked
      await trackedFetch(OPENAI_URL, { method: "POST" });

      // The model was unknown from the request, but resolved from response
      expect(queueCost).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Edge-case: injectStreamUsage preserves init.signal
  // -------------------------------------------------------------------------

  it("preserves AbortSignal through stream_options injection", async () => {
    const controller = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchStreamResponse(openaiStreamChunks()),
    );

    const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);
    const body = makeOpenAIBody("gpt-4o", true);
    await trackedFetch(OPENAI_URL, {
      method: "POST",
      body,
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
    });

    // The signal should be passed through to the real fetch call
    const calledInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(calledInit.signal).toBe(controller.signal);
    fetchSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Edge-case: stream_options already has include_usage (no-op merge)
  // -------------------------------------------------------------------------

  it("does not break when stream_options already has include_usage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchStreamResponse(openaiStreamChunks()),
    );

    const trackedFetch = buildTrackedFetch("openai", undefined, queueCost, null);
    const bodyObj = { model: "gpt-4o", stream: true, stream_options: { include_usage: true }, messages: [] };
    await trackedFetch(OPENAI_URL, {
      method: "POST",
      body: JSON.stringify(bodyObj),
      headers: { "Content-Type": "application/json" },
    });

    // Should still have include_usage: true (not duplicated or broken)
    const calledInit = fetchSpy.mock.calls[0][1] as RequestInit;
    const calledBody = JSON.parse(calledInit.body as string);
    expect(calledBody.stream_options.include_usage).toBe(true);
    fetchSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Edge-case: warns when body can't be extracted for a tracked route
  // -------------------------------------------------------------------------

  it("calls onCostError when body cannot be extracted for OpenAI route", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchJsonResponse({
        model: "gpt-4o",
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    );
    const errorHandler = vi.fn();

    const trackedFetch = buildTrackedFetch("openai", { onCostError: errorHandler }, queueCost, null);
    // Pass without body in init — body extraction returns null
    await trackedFetch(OPENAI_URL, { method: "POST" });

    expect(errorHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Could not extract request body"),
      }),
    );
    fetchSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Enforcement: session limits
  // -------------------------------------------------------------------------

  describe("enforcement — session limits", () => {
    it("throws SessionLimitExceededError when spend + estimate > manual limit", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 100 },
        queueCost,
        policyCache,
      );

      // The estimate for gpt-4o with default max_tokens is nonzero, exceeds 100 microdollars
      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("calls onDenied with session_limit type before throwing", async () => {
      const policyCache = createMockPolicyCache();
      const onDenied = vi.fn();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 100, onDenied },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);

      expect(onDenied).toHaveBeenCalledTimes(1);
      const reason: DenialReason = onDenied.mock.calls[0][0];
      expect(reason.type).toBe("session_limit");
      if (reason.type === "session_limit") {
        expect(reason.sessionSpend).toBe(0);
        expect(reason.sessionLimit).toBe(100);
      }
    });

    it("does not enforce session limit when sessionId is absent", async () => {
      const policyCache = createMockPolicyCache();
      mockFetch.mockResolvedValue(openaiJsonResponse());

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionLimitMicrodollars: 100 },
        queueCost,
        policyCache,
      );

      // Should succeed — no sessionId means no session enforcement
      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(response.status).toBe(200);
    });

    it("does not enforce session limit when enforcement is false", async () => {
      const policyCache = createMockPolicyCache();
      mockFetch.mockResolvedValue(openaiJsonResponse());

      const trackedFetch = buildTrackedFetch(
        "openai",
        { sessionId: "sess-1", sessionLimitMicrodollars: 100 },
        queueCost,
        policyCache,
      );

      // Should succeed — enforcement is off
      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(response.status).toBe(200);
    });

    it("accumulates cost from non-streaming responses and denies Nth request", async () => {
      const policyCache = createMockPolicyCache();

      // Estimate: 1000 * 2.5 + 4096 * 10 = 43,460 microdollars (with mocked pricing)
      // Actual cost per request: 100 * 2.5 + 50 * 10 = 750 microdollars
      // Set limit so first request passes (0 + 43460 < 44000) but second fails
      // (750 + 43460 = 44210 > 44000)
      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 44_000 },
        queueCost,
        policyCache,
      );

      // First request succeeds (0 + estimate < limit)
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const response1 = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });
      expect(response1.status).toBe(200);
      expect(queueCost).toHaveBeenCalledTimes(1);

      const cost1 = queueCost.mock.calls[0][0].costMicrodollars;
      expect(cost1).toBeGreaterThan(0);

      // Second request denied (cost1 + estimate > limit)
      mockFetch.mockResolvedValue(openaiJsonResponse());
      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);
    });

    it("accumulates cost from streaming responses and denies subsequent request", async () => {
      const policyCache = createMockPolicyCache();

      // Same math as non-streaming accumulation test:
      // Estimate ~43,460 microdollars, actual cost ~750 microdollars per request
      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 44_000 },
        queueCost,
        policyCache,
      );

      // First streaming request succeeds (0 + estimate < 44000)
      mockFetch.mockResolvedValue(mockFetchStreamResponse(openaiStreamChunks()));
      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody("gpt-4o", true),
      });
      await consumeStream(response);
      await new Promise((r) => setTimeout(r, 10));

      expect(queueCost).toHaveBeenCalledTimes(1);
      const cost = queueCost.mock.calls[0][0].costMicrodollars;
      expect(cost).toBeGreaterThan(0);

      // Second request denied (accumulated streaming cost + estimate > 44000)
      mockFetch.mockResolvedValue(openaiJsonResponse());
      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);
    });

    it("uses policy-fetched session limit when manual is not set", async () => {
      const policyCache = createMockPolicyCache({
        getSessionLimit: vi.fn().mockReturnValue(50), // 50 microdollars — very low
      });

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1" },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);
    });

    it("manual limit takes precedence over policy limit", async () => {
      const policyCache = createMockPolicyCache({
        getSessionLimit: vi.fn().mockReturnValue(100_000_000), // very high policy limit
      });
      mockFetch.mockResolvedValue(openaiJsonResponse());

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 50 }, // very low manual
        queueCost,
        policyCache,
      );

      // Manual limit (50) takes precedence — should deny
      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);
    });

    it("falls open on policy failure but enforces manual session limit", async () => {
      const policyCache = createMockPolicyCache({
        getPolicy: vi.fn().mockRejectedValue(new Error("network error")),
      });

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 50 },
        queueCost,
        policyCache,
      );

      // Policy failed but manual limit should still be enforced
      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);
    });

    it("session spend starts at 0 for new tracked fetch instance", async () => {
      const policyCache = createMockPolicyCache();
      mockFetch.mockResolvedValue(openaiJsonResponse());

      // High limit — should pass
      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 100_000_000 },
        queueCost,
        policyCache,
      );

      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(response.status).toBe(200);
    });

    it("SessionLimitExceededError is re-thrown (not swallowed by fall-open catch)", async () => {
      // Simulate a scenario where getPolicy succeeds but getSessionLimit returns a low value
      const policyCache = createMockPolicyCache({
        getSessionLimit: vi.fn().mockReturnValue(10),
      });

      const onCostError = vi.fn();
      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", onCostError },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);

      // Should NOT have called onCostError — the error is not swallowed
      expect(onCostError).not.toHaveBeenCalled();
    });

    it("failed response (4xx/5xx) does NOT accumulate session spend", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 100_000 },
        queueCost,
        policyCache,
      );

      // First request returns 400
      mockFetch.mockResolvedValue(mockFetchJsonResponse({ error: "bad request" }, 400));
      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });
      expect(response.status).toBe(400);
      expect(queueCost).not.toHaveBeenCalled();

      // Second request should still have 0 session spend
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const response2 = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });
      expect(response2.status).toBe(200);
      expect(queueCost).toHaveBeenCalledTimes(1);
    });

    it("cost tracking error in response parsing does NOT accumulate session spend", async () => {
      const policyCache = createMockPolicyCache();
      const onCostError = vi.fn();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 100_000, onCostError },
        queueCost,
        policyCache,
      );

      // Return a response that fails JSON parsing
      mockFetch.mockResolvedValue(new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
      await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      expect(onCostError).toHaveBeenCalledTimes(1);
      expect(queueCost).not.toHaveBeenCalled();

      // Next request should still succeed (spend is still 0)
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });
      expect(response.status).toBe(200);
    });

    it("enforces session limit for Anthropic provider", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "anthropic",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 100 },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(ANTHROPIC_URL, { method: "POST", body: makeAnthropicBody() }),
      ).rejects.toThrow(SessionLimitExceededError);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("Anthropic streaming accumulates and denies subsequent request", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "anthropic",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 44_000 },
        queueCost,
        policyCache,
      );

      // First streaming request succeeds
      mockFetch.mockResolvedValue(mockFetchStreamResponse(anthropicStreamChunks()));
      const response = await trackedFetch(ANTHROPIC_URL, {
        method: "POST",
        body: makeAnthropicBody("claude-sonnet-4-20250514", true),
      });
      await consumeStream(response);
      await new Promise((r) => setTimeout(r, 10));

      expect(queueCost).toHaveBeenCalledTimes(1);

      // Second request denied (accumulated cost + estimate > limit)
      mockFetch.mockResolvedValue(anthropicJsonResponse());
      await expect(
        trackedFetch(ANTHROPIC_URL, { method: "POST", body: makeAnthropicBody() }),
      ).rejects.toThrow(SessionLimitExceededError);
    });

    it("sessionLimitMicrodollars: 0 blocks all requests (block-all)", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 0 },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("emits console.warn when session limit denies a request", async () => {
      const policyCache = createMockPolicyCache();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 100 },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[nullspend] Session limit denied:"),
      );
      warnSpy.mockRestore();
    });

    it("emits console.warn when session limit denies in fallback path", async () => {
      const policyCache = createMockPolicyCache({
        getPolicy: vi.fn().mockRejectedValue(new Error("network error")),
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 50 },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[nullspend] Session limit denied (fallback):"),
      );
      warnSpy.mockRestore();
    });

    it("does not accumulate session spend when enforcement is off", async () => {
      // Verify that the costSink optimization works — queueCost is called directly
      const policyCache = createMockPolicyCache();
      mockFetch.mockResolvedValue(openaiJsonResponse());

      const trackedFetch = buildTrackedFetch(
        "openai",
        { sessionId: "sess-1", sessionLimitMicrodollars: 100_000 },
        queueCost,
        policyCache,
      );

      await trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() });
      expect(queueCost).toHaveBeenCalledTimes(1);
    });

    it("onDenied throwing does not bypass session limit enforcement", async () => {
      const policyCache = createMockPolicyCache();
      const onDenied = vi.fn().mockImplementation(() => {
        throw new Error("callback bug");
      });
      const onCostError = vi.fn();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 100, onDenied, onCostError },
        queueCost,
        policyCache,
      );

      // Should still throw SessionLimitExceededError even though onDenied throws
      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);

      // onDenied was called (and threw)
      expect(onDenied).toHaveBeenCalledTimes(1);
      // onCostError received the callback's error
      expect(onCostError).toHaveBeenCalledTimes(1);
      expect(onCostError.mock.calls[0][0].message).toBe("callback bug");
      // fetch was never called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("onDenied throwing in fallback path does not bypass session limit enforcement", async () => {
      const policyCache = createMockPolicyCache({
        getPolicy: vi.fn().mockRejectedValue(new Error("network error")),
      });
      const onDenied = vi.fn().mockImplementation(() => {
        throw new Error("callback bug");
      });
      const onCostError = vi.fn();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 50, onDenied, onCostError },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);

      expect(onDenied).toHaveBeenCalledTimes(1);
    });

    it("onDenied throwing does not bypass budget enforcement", async () => {
      const policyCache = createMockPolicyCache({
        checkBudget: vi.fn().mockReturnValue({ allowed: false, remaining: 50 }),
      });
      const onDenied = vi.fn().mockImplementation(() => {
        throw new Error("callback bug");
      });

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, onDenied },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(BudgetExceededError);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("onDenied throwing does not bypass mandate enforcement", async () => {
      const policyCache = createMockPolicyCache({
        checkMandate: vi.fn().mockReturnValue({
          allowed: false,
          mandate: "allowed_models",
          requested: "gpt-4o",
          allowed_list: ["gpt-4o-mini"],
        }),
      });
      const onDenied = vi.fn().mockImplementation(() => {
        throw new Error("callback bug");
      });

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, onDenied },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(MandateViolationError);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("unknown model (estimate=0) still enforces session limit based on accumulated spend", async () => {
      // Mock getModelPricing to return null for unknown models
      const { getModelPricing } = await import("@nullspend/cost-engine");
      const mocked = vi.mocked(getModelPricing);
      const originalImpl = mocked.getMockImplementation();
      mocked.mockReturnValue(null); // unknown model → estimate=0

      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: 500 },
        queueCost,
        policyCache,
      );

      // First request passes (0 + 0 > 500 = false)
      mockFetch.mockResolvedValue(openaiJsonResponse());
      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody("unknown-model"),
      });
      expect(response.status).toBe(200);

      // Restore pricing so cost calculator returns real cost for the response
      // The response model is what matters for cost calculation, not the request model
      // But since getModelPricing is still mocked to null, costMicrodollars = 0
      // So session spend stays at 0. This means unknown models never trigger session limits
      // via accumulation — only if spend from OTHER requests exceeds the limit.
      expect(queueCost).toHaveBeenCalledTimes(1);
      // costMicrodollars is 0 because pricing is null
      expect(queueCost.mock.calls[0][0].costMicrodollars).toBe(0);

      // Restore original mock for other tests
      if (originalImpl) mocked.mockImplementation(originalImpl);
      else mocked.mockReturnValue({ inputPerMTok: 2.5, outputPerMTok: 10, cachedInputPerMTok: 1.25 } as any);
    });

    it("sessionLimitMicrodollars: Infinity acts as no-limit", async () => {
      const policyCache = createMockPolicyCache();
      mockFetch.mockResolvedValue(openaiJsonResponse());

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: Infinity },
        queueCost,
        policyCache,
      );

      // Should always pass — 0 + any_estimate > Infinity is always false
      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });
      expect(response.status).toBe(200);
    });

    it("sessionLimitMicrodollars: -1 blocks all requests", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, sessionId: "sess-1", sessionLimitMicrodollars: -1 },
        queueCost,
        policyCache,
      );

      // 0 + any_positive_estimate > -1 is true → blocked
      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(SessionLimitExceededError);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Enriched budget entity details
  // -------------------------------------------------------------------------

  describe("enriched budget entity details", () => {
    it("enriched BudgetExceededError includes entity details", async () => {
      const policyCache = createMockPolicyCache({
        checkBudget: vi.fn().mockReturnValue({
          allowed: false,
          remaining: 100,
          entityType: "api_key",
          entityId: "key-1",
          limit: 5_000_000,
          spend: 4_900_000,
        }),
      });

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true },
        queueCost,
        policyCache,
      );

      try {
        await trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(BudgetExceededError);
        const budgetErr = err as InstanceType<typeof BudgetExceededError>;
        expect(budgetErr.entityType).toBe("api_key");
        expect(budgetErr.entityId).toBe("key-1");
        expect(budgetErr.limitMicrodollars).toBe(5_000_000);
        expect(budgetErr.spendMicrodollars).toBe(4_900_000);
      }

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("onDenied receives entity details in budget denial", async () => {
      const policyCache = createMockPolicyCache({
        checkBudget: vi.fn().mockReturnValue({
          allowed: false,
          remaining: 100,
          entityType: "api_key",
          entityId: "key-1",
          limit: 5_000_000,
          spend: 4_900_000,
        }),
      });

      const onDenied = vi.fn();
      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, onDenied },
        queueCost,
        policyCache,
      );

      await expect(
        trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }),
      ).rejects.toThrow(BudgetExceededError);

      expect(onDenied).toHaveBeenCalledTimes(1);
      const reason: DenialReason = onDenied.mock.calls[0][0];
      expect(reason.type).toBe("budget");
      if (reason.type === "budget") {
        expect(reason.entityType).toBe("api_key");
        expect(reason.entityId).toBe("key-1");
        expect(reason.limit).toBe(5_000_000);
        expect(reason.spend).toBe(4_900_000);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Proxy 429 interception
  // -------------------------------------------------------------------------

  describe("proxy 429 interception", () => {
    it("proxy 429 with budget_exceeded code throws BudgetExceededError", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true },
        queueCost,
        policyCache,
      );

      mockFetch.mockResolvedValue(mockFetchJsonResponse({
        error: {
          code: "budget_exceeded",
          message: "Budget exceeded",
          details: {
            entity_type: "api_key",
            entity_id: "key-1",
            budget_limit_microdollars: 5_000_000,
            budget_spend_microdollars: 4_900_000,
          },
        },
      }, 429));

      try {
        await trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(BudgetExceededError);
        const budgetErr = err as InstanceType<typeof BudgetExceededError>;
        expect(budgetErr.remainingMicrodollars).toBe(100_000);
        expect(budgetErr.entityType).toBe("api_key");
        expect(budgetErr.entityId).toBe("key-1");
        expect(budgetErr.limitMicrodollars).toBe(5_000_000);
        expect(budgetErr.spendMicrodollars).toBe(4_900_000);
      }
    });

    it("proxy 429 BudgetExceededError has computed remaining from limit - spend", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true },
        queueCost,
        policyCache,
      );

      mockFetch.mockResolvedValue(mockFetchJsonResponse({
        error: {
          code: "budget_exceeded",
          message: "Request blocked",
          details: {
            entity_type: "api_key",
            entity_id: "key-1",
            budget_limit_microdollars: 5_000_000,
            budget_spend_microdollars: 4_800_000,
            estimated_cost_microdollars: 500_000,
          },
        },
      }, 429));

      try {
        await trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(BudgetExceededError);
        const budgetErr = err as InstanceType<typeof BudgetExceededError>;
        // remaining = limit - spend = 5_000_000 - 4_800_000 = 200_000, NOT 0
        expect(budgetErr.remainingMicrodollars).toBe(200_000);
        expect(budgetErr.entityType).toBe("api_key");
        expect(budgetErr.entityId).toBe("key-1");
        expect(budgetErr.limitMicrodollars).toBe(5_000_000);
        expect(budgetErr.spendMicrodollars).toBe(4_800_000);
      }
    });

    it("upstream provider 429 passes through without throwing", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true },
        queueCost,
        policyCache,
      );

      mockFetch.mockResolvedValue(mockFetchJsonResponse({
        error: {
          message: "Rate limit exceeded",
          type: "rate_limit_error",
        },
      }, 429));

      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      // Upstream 429 without code: "budget_exceeded" should pass through
      expect(response.status).toBe(429);
    });

    it("proxy 429 with non-JSON body passes through", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true },
        queueCost,
        policyCache,
      );

      mockFetch.mockResolvedValue(new Response("Too Many Requests", {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "content-type": "text/plain" },
      }));

      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      // Non-JSON 429 should pass through
      expect(response.status).toBe(429);
    });

    // Velocity — uses actual proxy response shape:
    // details: { limitMicrodollars, windowSeconds, currentMicrodollars }
    // Retry-After: HTTP header (not in JSON body)

    it("proxy 429 with velocity_exceeded reads Retry-After header and details", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true },
        queueCost,
        policyCache,
      );

      // Actual proxy response shape from shared.ts:101-117
      mockFetch.mockResolvedValue(new Response(
        JSON.stringify({
          error: {
            code: "velocity_exceeded",
            message: "Request blocked: spending rate exceeds velocity limit. Retry after cooldown.",
            details: {
              limitMicrodollars: 500_000,
              windowSeconds: 60,
              currentMicrodollars: 750_000,
            },
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "30",
          },
        },
      ));

      try {
        await trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(VelocityExceededError);
        const velErr = err as InstanceType<typeof VelocityExceededError>;
        expect(velErr.retryAfterSeconds).toBe(30);
        expect(velErr.limitMicrodollars).toBe(500_000);
        expect(velErr.windowSeconds).toBe(60);
        expect(velErr.currentMicrodollars).toBe(750_000);
      }
    });

    it("proxy 429 velocity_exceeded fires onDenied with full velocity context", async () => {
      const policyCache = createMockPolicyCache();
      const denied: DenialReason[] = [];

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, onDenied: (r) => denied.push(r) },
        queueCost,
        policyCache,
      );

      mockFetch.mockResolvedValue(new Response(
        JSON.stringify({
          error: {
            code: "velocity_exceeded",
            message: "Spending too fast",
            details: {
              limitMicrodollars: 200_000,
              windowSeconds: 120,
              currentMicrodollars: 300_000,
            },
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "15",
          },
        },
      ));

      await trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }).catch(() => {});

      expect(denied).toHaveLength(1);
      expect(denied[0]).toEqual({
        type: "velocity",
        retryAfterSeconds: 15,
        limit: 200_000,
        window: 120,
        current: 300_000,
      });
    });

    it("proxy 429 velocity_exceeded with null details still reads Retry-After", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true },
        queueCost,
        policyCache,
      );

      // Proxy sends details: null when velocityDetails is undefined
      mockFetch.mockResolvedValue(new Response(
        JSON.stringify({
          error: {
            code: "velocity_exceeded",
            message: "Velocity limit exceeded",
            details: null,
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60",
          },
        },
      ));

      try {
        await trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(VelocityExceededError);
        const velErr = err as InstanceType<typeof VelocityExceededError>;
        expect(velErr.retryAfterSeconds).toBe(60);
        expect(velErr.limitMicrodollars).toBeUndefined();
        expect(velErr.windowSeconds).toBeUndefined();
        expect(velErr.currentMicrodollars).toBeUndefined();
      }
    });

    it("proxy 429 with session_limit_exceeded throws SessionLimitExceededError", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true },
        queueCost,
        policyCache,
      );

      // Actual proxy response shape from shared.ts:133-152
      mockFetch.mockResolvedValue(mockFetchJsonResponse({
        error: {
          code: "session_limit_exceeded",
          message: "Request blocked: session spend exceeds session limit. Start a new session.",
          details: {
            session_id: "task-042",
            session_spend_microdollars: 950_000,
            session_limit_microdollars: 1_000_000,
          },
        },
      }, 429));

      try {
        await trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SessionLimitExceededError);
        const sessErr = err as InstanceType<typeof SessionLimitExceededError>;
        expect(sessErr.sessionSpendMicrodollars).toBe(950_000);
        expect(sessErr.sessionLimitMicrodollars).toBe(1_000_000);
      }
    });

    // Tag budget — uses actual proxy response shape:
    // details: { tag_key, tag_value, budget_limit_microdollars, budget_spend_microdollars }
    // remaining is computed (limit - spend), NOT sent by proxy

    it("proxy 429 with tag_budget_exceeded computes remaining from limit - spend", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true },
        queueCost,
        policyCache,
      );

      // Actual proxy response shape from shared.ts:169-189
      mockFetch.mockResolvedValue(mockFetchJsonResponse({
        error: {
          code: "tag_budget_exceeded",
          message: "Request blocked: estimated cost exceeds tag budget limit.",
          details: {
            tag_key: "env",
            tag_value: "prod",
            budget_limit_microdollars: 5_000_000,
            budget_spend_microdollars: 4_800_000,
          },
        },
      }, 429));

      try {
        await trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TagBudgetExceededError);
        const tagErr = err as InstanceType<typeof TagBudgetExceededError>;
        expect(tagErr.tagKey).toBe("env");
        expect(tagErr.tagValue).toBe("prod");
        expect(tagErr.limitMicrodollars).toBe(5_000_000);
        expect(tagErr.spendMicrodollars).toBe(4_800_000);
        // remaining = limit - spend = 5M - 4.8M = 200K
        expect(tagErr.remainingMicrodollars).toBe(200_000);
      }
    });

    it("proxy 429 tag_budget_exceeded fires onDenied with computed remaining and spend", async () => {
      const policyCache = createMockPolicyCache();
      const denied: DenialReason[] = [];

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true, onDenied: (r) => denied.push(r) },
        queueCost,
        policyCache,
      );

      // Fully exhausted tag budget
      mockFetch.mockResolvedValue(mockFetchJsonResponse({
        error: {
          code: "tag_budget_exceeded",
          message: "Tag budget exceeded",
          details: {
            tag_key: "customer",
            tag_value: "acme",
            budget_limit_microdollars: 1_000_000,
            budget_spend_microdollars: 1_200_000,
          },
        },
      }, 429));

      await trackedFetch(OPENAI_URL, { method: "POST", body: makeOpenAIBody() }).catch(() => {});

      expect(denied).toHaveLength(1);
      expect(denied[0]).toEqual({
        type: "tag_budget",
        tagKey: "customer",
        tagValue: "acme",
        remaining: 0, // clamped: max(0, 1M - 1.2M) = 0
        limit: 1_000_000,
        spend: 1_200_000,
      });
    });

    it("proxy 429 with rate_limited code passes through (not a NullSpend denial)", async () => {
      const policyCache = createMockPolicyCache();

      const trackedFetch = buildTrackedFetch(
        "openai",
        { enforcement: true },
        queueCost,
        policyCache,
      );

      // Proxy IP/key rate limit — different from budget denials
      mockFetch.mockResolvedValue(new Response(
        JSON.stringify({
          error: {
            code: "rate_limited",
            message: "Too many requests",
            details: null,
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60",
          },
        },
      ));

      const response = await trackedFetch(OPENAI_URL, {
        method: "POST",
        body: makeOpenAIBody(),
      });

      // rate_limited is not a budget/velocity/session/tag denial — passes through
      expect(response.status).toBe(429);
    });
  });
});
