import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

beforeAll(() => {
  if (!crypto.subtle.timingSafeEqual) {
    (crypto.subtle as any).timingSafeEqual = (a: ArrayBuffer, b: ArrayBuffer) => {
      const viewA = new Uint8Array(a);
      const viewB = new Uint8Array(b);
      if (viewA.byteLength !== viewB.byteLength) return false;
      let result = 0;
      for (let i = 0; i < viewA.byteLength; i++) {
        result |= viewA[i] ^ viewB[i];
      }
      return result === 0;
    };
  }
});

vi.mock("cloudflare:workers", () => ({
  waitUntil: vi.fn((promise: Promise<unknown>) => {
    promise.catch(() => {});
  }),
}));

vi.mock("@agentseam/cost-engine", () => ({
  isKnownModel: vi.fn().mockReturnValue(true),
  getModelPricing: vi.fn().mockReturnValue({
    inputPerMTok: 3,
    outputPerMTok: 15,
    cachedInputPerMTok: 0.3,
  }),
  costComponent: vi.fn().mockReturnValue(100),
}));

const { mockLookupBudgets } = vi.hoisted(() => {
  const mockLookupBudgets = vi.fn();
  return { mockLookupBudgets };
});
vi.mock("../lib/budget-lookup.js", () => ({
  lookupBudgets: mockLookupBudgets,
}));

const { mockCheckAndReserve } = vi.hoisted(() => {
  const mockCheckAndReserve = vi.fn();
  return { mockCheckAndReserve };
});
vi.mock("../lib/budget.js", () => ({
  checkAndReserve: mockCheckAndReserve,
}));

const { mockReconcileReservation } = vi.hoisted(() => {
  const mockReconcileReservation = vi.fn().mockResolvedValue(undefined);
  return { mockReconcileReservation };
});
vi.mock("../lib/budget-reconcile.js", () => ({
  reconcileReservation: mockReconcileReservation,
}));

const { mockEstimateAnthropicMaxCost } = vi.hoisted(() => {
  const mockEstimateAnthropicMaxCost = vi.fn().mockReturnValue(500_000);
  return { mockEstimateAnthropicMaxCost };
});
vi.mock("../lib/anthropic-cost-estimator.js", () => ({
  estimateAnthropicMaxCost: mockEstimateAnthropicMaxCost,
}));

vi.mock("@upstash/redis/cloudflare", () => ({
  Redis: {
    fromEnv: vi.fn().mockReturnValue({ pipeline: vi.fn() }),
  },
}));

import { handleAnthropicMessages } from "../routes/anthropic.js";

const BUDGET_ENTITY = {
  entityKey: "{budget}:api_key:test-key-id",
  entityType: "api_key",
  entityId: "test-key-id",
  maxBudget: 10_000_000,
  spend: 1_000_000,
  reserved: 0,
  policy: "hard",
};

const ANTHROPIC_RESPONSE = {
  id: "msg_01XFDUDYJgAACzvnptvVoYEL",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-20250514",
  content: [{ type: "text", text: "Hello!" }],
  stop_reason: "end_turn",
  usage: {
    input_tokens: 25,
    output_tokens: 10,
  },
};

function makeRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-ant-api03-test",
      "X-AgentSeam-Auth": "test-platform-key",
      "X-AgentSeam-Key-Id": "test-key-id",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function makeEnv(): Env {
  return {
    PLATFORM_AUTH_KEY: "test-platform-key",
    OPENAI_API_KEY: "sk-test-key",
    HYPERDRIVE: {
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    },
    UPSTASH_REDIS_REST_URL: "https://fake.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "fake-token",
  } as Env;
}

function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("Anthropic budget enforcement", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockLookupBudgets.mockReset();
    mockCheckAndReserve.mockReset();
    mockReconcileReservation.mockReset().mockResolvedValue(undefined);
    mockEstimateAnthropicMaxCost.mockReset().mockReturnValue(500_000);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("budget denial returns 429 with budget_exceeded error shape", async () => {
    mockLookupBudgets.mockResolvedValue([BUDGET_ENTITY]);
    mockCheckAndReserve.mockResolvedValue({
      status: "denied",
      entityKey: BUDGET_ENTITY.entityKey,
      remaining: 100_000,
      maxBudget: BUDGET_ENTITY.maxBudget,
      spend: 9_900_000,
    });

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe("budget_exceeded");
    expect(json.message).toContain("budget");
    expect(json.details).toBeUndefined();
  });

  it("successful non-streaming request reconciles with actual cost", async () => {
    mockLookupBudgets.mockResolvedValue([BUDGET_ENTITY]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv_test_123",
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(ANTHROPIC_RESPONSE), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req_budget_test",
        },
      }),
    );

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.status).toBe(200);

    // waitUntil fires reconciliation asynchronously; verify it was called
    await vi.waitFor(() => {
      expect(mockReconcileReservation).toHaveBeenCalled();
    });
    const callArgs = mockReconcileReservation.mock.calls[0];
    expect(callArgs[1]).toBe("rsv_test_123");
    expect(callArgs[2]).toBeGreaterThan(0);
  });

  it("upstream 4xx error reconciles reservation with 0", async () => {
    mockLookupBudgets.mockResolvedValue([BUDGET_ENTITY]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv_test_err",
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }),
        {
          status: 400,
          headers: { "content-type": "application/json", "request-id": "req_err" },
        },
      ),
    );

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.status).toBe(400);

    await vi.waitFor(() => {
      expect(mockReconcileReservation).toHaveBeenCalled();
    });
    const callArgs = mockReconcileReservation.mock.calls[0];
    expect(callArgs[1]).toBe("rsv_test_err");
    expect(callArgs[2]).toBe(0);
  });

  it("budget lookup failure returns 503 budget_unavailable", async () => {
    mockLookupBudgets.mockRejectedValue(new Error("Redis connection failed"));

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("budget_unavailable");
  });

  it("no budget entities skips enforcement entirely", async () => {
    mockLookupBudgets.mockResolvedValue([]);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(ANTHROPIC_RESPONSE), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "request-id": "req_no_budget",
        },
      }),
    );

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.status).toBe(200);
    expect(mockCheckAndReserve).not.toHaveBeenCalled();
    expect(mockReconcileReservation).not.toHaveBeenCalled();
  });

  it("streaming request reconciles after stream completes", async () => {
    mockLookupBudgets.mockResolvedValue([BUDGET_ENTITY]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv_stream_test",
    });

    const sseChunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":25,"output_tokens":0}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeSSEStream(sseChunks), {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "request-id": "req_stream_budget",
        },
      }),
    );

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };
    const res = await handleAnthropicMessages(makeRequest(body), makeEnv(), body);

    expect(res.status).toBe(200);
    // Consume the stream to trigger the waitUntil callback
    await res.text();

    await vi.waitFor(() => {
      expect(mockReconcileReservation).toHaveBeenCalled();
    });
    const callArgs = mockReconcileReservation.mock.calls[0];
    expect(callArgs[1]).toBe("rsv_stream_test");
    expect(callArgs[2]).toBeGreaterThan(0);
  });

  it("timeout/error reconciles reservation with 0 via outer catch", async () => {
    mockLookupBudgets.mockResolvedValue([BUDGET_ENTITY]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv_timeout_test",
    });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("fetch timeout"));

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      messages: [{ role: "user", content: "hi" }],
    };

    await expect(
      handleAnthropicMessages(makeRequest(body), makeEnv(), body),
    ).rejects.toThrow("fetch timeout");

    await vi.waitFor(() => {
      expect(mockReconcileReservation).toHaveBeenCalled();
    });
    const callArgs = mockReconcileReservation.mock.calls[0];
    expect(callArgs[1]).toBe("rsv_timeout_test");
    expect(callArgs[2]).toBe(0);
  });
});
