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

vi.mock("@nullspend/cost-engine", () => ({
  isKnownModel: vi.fn().mockReturnValue(true),
  getModelPricing: vi.fn().mockReturnValue({
    inputPerMTok: 0.15,
    outputPerMTok: 0.60,
    cachedInputPerMTok: 0.075,
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

const { mockEstimateMaxCost } = vi.hoisted(() => {
  const mockEstimateMaxCost = vi.fn().mockReturnValue(500_000);
  return { mockEstimateMaxCost };
});
vi.mock("../lib/cost-estimator.js", () => ({
  estimateMaxCost: mockEstimateMaxCost,
}));

vi.mock("../lib/budget-do-lookup.js", () => ({
  lookupBudgetsForDO: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/budget-do-client.js", () => ({
  doBudgetCheck: vi.fn().mockResolvedValue({ status: "skipped" }),
  doBudgetReconcile: vi.fn().mockResolvedValue(undefined),
  doBudgetPopulate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@upstash/redis/cloudflare", () => ({
  Redis: {
    fromEnv: vi.fn().mockReturnValue({ pipeline: vi.fn() }),
  },
}));

import { handleChatCompletions } from "../routes/openai.js";
import type { RequestContext } from "../lib/context.js";
import { makeFakeRedis } from "./helpers/make-fake-redis.js";

const BUDGET_ENTITY = {
  entityKey: "{budget}:api_key:test-key-id",
  entityType: "api_key",
  entityId: "test-key-id",
  maxBudget: 10_000_000,
  spend: 1_000_000,
  reserved: 0,
  policy: "hard",
};

const OPENAI_RESPONSE = {
  id: "chatcmpl-test",
  model: "gpt-4o-mini-2024-07-18",
  choices: [{ index: 0, message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" }],
  usage: {
    prompt_tokens: 25,
    completion_tokens: 10,
  },
};

function makeRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test-key",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function makeEnv(): Env {
  return {
    OPENAI_API_KEY: "sk-test-key",
    HYPERDRIVE: {
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    },
    UPSTASH_REDIS_REST_URL: "https://fake.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "fake-token",
    BUDGET_ENGINE: "redis",
    CACHE_KV: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
    USER_BUDGET: {
      idFromName: vi.fn().mockReturnValue({ toString: () => "do-id" }),
      get: vi.fn().mockReturnValue({
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "approved" }))),
      }),
    },
  } as Env;
}

function makeCtx(
  body: Record<string, unknown>,
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    body,
    auth: { userId: "user-1", keyId: "a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e40001", hasBudgets: true, hasWebhooks: false },
    redis: makeFakeRedis(),
    connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    sessionId: null,
    webhookDispatcher: null,
    ...overrides,
  };
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

describe("OpenAI budget enforcement", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    mockLookupBudgets.mockReset();
    mockCheckAndReserve.mockReset();
    mockReconcileReservation.mockReset().mockResolvedValue(undefined);
    mockEstimateMaxCost.mockReset().mockReturnValue(500_000);
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
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleChatCompletions(makeRequest(body), makeEnv(), makeCtx(body));

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
      new Response(JSON.stringify(OPENAI_RESPONSE), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_budget_test",
        },
      }),
    );

    const body = {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleChatCompletions(makeRequest(body), makeEnv(), makeCtx(body));

    expect(res.status).toBe(200);

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
        JSON.stringify({ error: { type: "invalid_request_error", message: "bad" } }),
        {
          status: 400,
          headers: { "content-type": "application/json", "x-request-id": "req_err" },
        },
      ),
    );

    const body = {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleChatCompletions(makeRequest(body), makeEnv(), makeCtx(body));

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
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleChatCompletions(makeRequest(body), makeEnv(), makeCtx(body));

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("budget_unavailable");
  });

  it("no budget entities skips enforcement entirely", async () => {
    mockLookupBudgets.mockResolvedValue([]);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(OPENAI_RESPONSE), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_no_budget",
        },
      }),
    );

    const body = {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    };
    const res = await handleChatCompletions(makeRequest(body), makeEnv(), makeCtx(body));

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
      'data: {"id":"chatcmpl-1","model":"gpt-4o-mini","choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"id":"chatcmpl-1","model":"gpt-4o-mini","choices":[],"usage":{"prompt_tokens":25,"completion_tokens":10}}\n\n',
      "data: [DONE]\n\n",
    ];

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeSSEStream(sseChunks), {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "req_stream_budget",
        },
      }),
    );

    const body = {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };
    const res = await handleChatCompletions(makeRequest(body), makeEnv(), makeCtx(body));

    expect(res.status).toBe(200);
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
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hi" }],
    };

    await expect(
      handleChatCompletions(makeRequest(body), makeEnv(), makeCtx(body)),
    ).rejects.toThrow("fetch timeout");

    await vi.waitFor(() => {
      expect(mockReconcileReservation).toHaveBeenCalled();
    });
    const callArgs = mockReconcileReservation.mock.calls[0];
    expect(callArgs[1]).toBe("rsv_timeout_test");
    expect(callArgs[2]).toBe(0);
  });
});
