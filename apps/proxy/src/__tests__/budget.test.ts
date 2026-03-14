/**
 * P0 Budget Enforcement Test Suite
 *
 * Tests budget enforcement integration in the proxy route handler.
 * Mocks Redis (via @upstash/redis/cloudflare), Postgres (via budget-lookup
 * and budget-spend), and upstream fetch to verify the full budget lifecycle.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

// --- Polyfills ---
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

// --- Mocks (vi.hoisted runs before vi.mock hoisting) ---

const {
  mockWaitUntil,
  mockLookupBudgets,
  mockCheckAndReserve,
  mockReconcile,
  mockEstimateMaxCost,
  mockUpdateBudgetSpend,
} = vi.hoisted(() => ({
  mockWaitUntil: vi.fn((promise: Promise<unknown>) => { promise.catch(() => {}); }),
  mockLookupBudgets: vi.fn(),
  mockCheckAndReserve: vi.fn(),
  mockReconcile: vi.fn(),
  mockEstimateMaxCost: vi.fn(),
  mockUpdateBudgetSpend: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: mockWaitUntil,
}));

vi.mock("@agentseam/cost-engine", () => ({
  isKnownModel: vi.fn().mockReturnValue(true),
  getModelPricing: vi.fn().mockReturnValue({
    inputPerMTok: 0.15,
    cachedInputPerMTok: 0.075,
    outputPerMTok: 0.60,
  }),
  costComponent: vi.fn((tokens: number, rate: number) => {
    if (tokens <= 0 || rate <= 0) return 0;
    return tokens * rate;
  }),
}));

vi.mock("../lib/budget-lookup.js", () => ({
  lookupBudgets: (...args: unknown[]) => mockLookupBudgets(...args),
}));

vi.mock("../lib/budget.js", () => ({
  checkAndReserve: (...args: unknown[]) => mockCheckAndReserve(...args),
  reconcile: (...args: unknown[]) => mockReconcile(...args),
}));

vi.mock("../lib/cost-estimator.js", () => ({
  estimateMaxCost: (...args: unknown[]) => mockEstimateMaxCost(...args),
}));

vi.mock("../lib/budget-spend.js", () => ({
  updateBudgetSpend: (...args: unknown[]) => mockUpdateBudgetSpend(...args),
}));

vi.mock("../lib/cost-logger.js", () => ({
  logCostEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@upstash/redis/cloudflare", () => ({
  Redis: {
    fromEnv: vi.fn(() => ({})),
  },
}));

import { handleChatCompletions } from "../routes/openai.js";

// --- Test Helpers ---

function makeRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test-key",
      "X-AgentSeam-Auth": "test-platform-key",
      "X-AgentSeam-Key-Id": "key-uuid-123",
      "X-AgentSeam-User-Id": "user-uuid-456",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    PLATFORM_AUTH_KEY: "test-platform-key",
    OPENAI_API_KEY: "sk-test-key",
    HYPERDRIVE: {
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    },
    UPSTASH_REDIS_REST_URL: "https://fake.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "fake-token",
    ...overrides,
  } as Env;
}

function makeSuccessResponse(usage = { prompt_tokens: 10, completion_tokens: 5 }) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-test",
      model: "gpt-4o-mini-2024-07-18",
      choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
      usage,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req-test" },
    },
  );
}

const defaultBody = {
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "hi" }],
};

const keyEntity = {
  entityKey: "{budget}:api_key:key-uuid-123",
  entityType: "api_key",
  entityId: "key-uuid-123",
  maxBudget: 50_000_000,
  spend: 10_000_000,
  reserved: 0,
  policy: "strict_block",
};

const userEntity = {
  entityKey: "{budget}:user:user-uuid-456",
  entityType: "user",
  entityId: "user-uuid-456",
  maxBudget: 5_000_000,
  spend: 1_000_000,
  reserved: 0,
  policy: "strict_block",
};

// --- Tests ---

describe("Budget Enforcement", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockWaitUntil.mockClear();
    mockLookupBudgets.mockReset();
    mockCheckAndReserve.mockReset();
    mockReconcile.mockReset();
    mockEstimateMaxCost.mockReset();
    mockUpdateBudgetSpend.mockReset();

    mockReconcile.mockResolvedValue({ status: "reconciled", spends: {} });
    mockUpdateBudgetSpend.mockResolvedValue(undefined);
    mockEstimateMaxCost.mockReturnValue(500_000);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // --- No budget configured ---

  it("passes through without budget calls when no budgets configured", async () => {
    mockLookupBudgets.mockResolvedValue([]);
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    expect(res.status).toBe(200);
    expect(mockCheckAndReserve).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  // --- P0-1: Identity-based budget check ---

  it("P0-1: uses x-agentseam-key-id and x-agentseam-user-id for budget lookup", async () => {
    mockLookupBudgets.mockResolvedValue([]);
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    expect(mockLookupBudgets).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "key-uuid-123",
      "user-uuid-456",
    );
  });

  // --- P0-2: Most-restrictive-entity-wins ---

  it("P0-2: denies when user budget is more restrictive than key budget", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity, userEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "denied",
      entityKey: "{budget}:user:user-uuid-456",
      remaining: 4_000_000,
      maxBudget: 5_000_000,
      spend: 1_000_000,
    });

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
    expect(body.message).toContain("budget");
  });

  // --- P0-3: Concurrent requests ---

  it("P0-3: only first request succeeds when two together exceed budget", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);

    // First request approved
    mockCheckAndReserve.mockResolvedValueOnce({
      status: "approved",
      reservationId: "rsv-1",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    const res1 = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);
    expect(res1.status).toBe(200);

    // Second request denied (simulating post-reservation state)
    mockCheckAndReserve.mockResolvedValueOnce({
      status: "denied",
      entityKey: "{budget}:api_key:key-uuid-123",
      remaining: 100_000,
      maxBudget: 50_000_000,
      spend: 49_400_000,
    });

    const res2 = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);
    expect(res2.status).toBe(429);
  });

  // --- P0-9: Unknown model fallback ---

  it("P0-9: unknown model uses fallback estimate but still enforces budget", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockEstimateMaxCost.mockReturnValue(1_000_000); // $1 fallback
    mockCheckAndReserve.mockResolvedValue({
      status: "denied",
      entityKey: "{budget}:api_key:key-uuid-123",
      remaining: 500_000,
      maxBudget: 50_000_000,
      spend: 49_500_000,
    });

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);
    expect(res.status).toBe(429);
    expect(mockEstimateMaxCost).toHaveBeenCalled();
  });

  // --- Budget exhausted ---

  it("returns 429 with budget_exceeded details when budget is exhausted", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "denied",
      entityKey: "{budget}:api_key:key-uuid-123",
      remaining: 0,
      maxBudget: 50_000_000,
      spend: 50_000_000,
    });

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
    expect(body.message).toContain("budget");
    expect(body.details).toBeUndefined();
  });

  // --- Budget has room ---

  it("proceeds normally when budget has room and reconciles spend", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-ok",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    expect(res.status).toBe(200);
    // waitUntil should be called for cost logging + reconciliation
    expect(mockWaitUntil).toHaveBeenCalled();
  });

  // --- Redis down ---

  it("returns 503 when Redis is down during budget lookup", async () => {
    mockLookupBudgets.mockRejectedValue(new Error("Redis connection failed"));

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("budget_unavailable");
  });

  it("returns 503 when Redis is down during checkAndReserve", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockRejectedValue(new Error("Redis eval failed"));

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("budget_unavailable");
  });

  // --- Fix 6: Upstream error reconciliation ---

  it("Fix 6: reconciles reservation with actualCost=0 on upstream 400 error", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-upstream-err",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "bad request" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    expect(res.status).toBe(400);
    expect(mockWaitUntil).toHaveBeenCalled();

    // Drain all waitUntil promises to trigger reconciliation
    await Promise.all(
      mockWaitUntil.mock.calls.map(([p]: [Promise<unknown>]) => p.catch(() => {})),
    );

    expect(mockReconcile).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-upstream-err",
      ["{budget}:api_key:key-uuid-123"],
      0,
    );
  });

  it("Fix 6: reconciles reservation with actualCost=0 on upstream 500 error", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-500",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);
    expect(res.status).toBe(500);

    await Promise.all(
      mockWaitUntil.mock.calls.map(([p]: [Promise<unknown>]) => p.catch(() => {})),
    );

    expect(mockReconcile).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-500",
      ["{budget}:api_key:key-uuid-123"],
      0,
    );
  });

  // --- Fix 6: Non-streaming parse failure ---

  it("Fix 6: reconciles on non-streaming unparseable response", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-parse-fail",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req-parse" },
      }),
    );

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);
    expect(res.status).toBe(200);

    await Promise.all(
      mockWaitUntil.mock.calls.map(([p]: [Promise<unknown>]) => p.catch(() => {})),
    );

    expect(mockReconcile).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-parse-fail",
      ["{budget}:api_key:key-uuid-123"],
      0,
    );
  });

  // --- Fix 11: Fetch error reconciliation ---

  it("Fix 11: reconciles on fetch AbortError (timeout)", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-timeout",
    });
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));

    await expect(
      handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody),
    ).rejects.toThrow();

    await Promise.all(
      mockWaitUntil.mock.calls.map(([p]: [Promise<unknown>]) => p.catch(() => {})),
    );

    expect(mockReconcile).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-timeout",
      ["{budget}:api_key:key-uuid-123"],
      0,
    );
  });

  it("Fix 11: reconciles on unexpected exception after reservation", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-unexpected",
    });
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network failure"));

    await expect(
      handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody),
    ).rejects.toThrow("network failure");

    await Promise.all(
      mockWaitUntil.mock.calls.map(([p]: [Promise<unknown>]) => p.catch(() => {})),
    );

    expect(mockReconcile).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-unexpected",
      ["{budget}:api_key:key-uuid-123"],
      0,
    );
  });

  // --- Reconcile failure does not affect response ---

  it("reconcile failure in waitUntil does not affect response delivery", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-reconcile-fail",
    });
    mockReconcile.mockRejectedValue(new Error("Redis went away"));
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);
    expect(res.status).toBe(200);

    // waitUntil fires but failure is swallowed
    await Promise.all(
      mockWaitUntil.mock.calls.map(([p]: [Promise<unknown>]) => p.catch(() => {})),
    );
  });

  // --- max_tokens estimation ---

  it("passes body to estimateMaxCost for cost estimation", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-est",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    const bodyWithMaxTokens = { ...defaultBody, max_tokens: 100 };
    await handleChatCompletions(makeRequest(bodyWithMaxTokens), makeEnv(), bodyWithMaxTokens);

    expect(mockEstimateMaxCost).toHaveBeenCalledWith("gpt-4o-mini", bodyWithMaxTokens);
  });

  // --- P0-7: Failed upstream = zero cost ---

  it("P0-7: failed upstream response produces zero cost budget update", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-upstream-fail",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "bad" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    await Promise.all(
      mockWaitUntil.mock.calls.map(([p]: [Promise<unknown>]) => p.catch(() => {})),
    );

    // Reconcile called with 0 cost
    expect(mockReconcile).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-upstream-fail",
      expect.any(Array),
      0,
    );
  });

  // --- P0-25: Sensitive headers never leaked ---

  it("P0-25: x-agentseam-auth never appears in budget error responses", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "denied",
      entityKey: "{budget}:api_key:key-uuid-123",
      remaining: 0,
      maxBudget: 50_000_000,
      spend: 50_000_000,
    });

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);
    const responseText = await res.text();
    expect(responseText).not.toContain("x-agentseam-auth");
    expect(responseText).not.toContain("test-platform-key");
  });

  // --- Non-streaming with usage triggers reconciliation with actual cost ---

  it("non-streaming success reconciles with actual cost from usage", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-actual-cost",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);
    expect(res.status).toBe(200);

    await Promise.all(
      mockWaitUntil.mock.calls.map(([p]: [Promise<unknown>]) => p.catch(() => {})),
    );

    // Reconcile should have been called with some cost > 0
    const reconcileCalls = mockReconcile.mock.calls;
    const hasNonZeroCost = reconcileCalls.some(
      (call: unknown[]) => typeof call[3] === "number" && call[3] > 0,
    );
    expect(hasNonZeroCost).toBe(true);
  });

  // --- Non-streaming no usage reconciles with 0 ---

  it("non-streaming response without usage reconciles with actualCost=0", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-no-usage",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          model: "gpt-4o-mini",
          choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "req-no-usage" },
        },
      ),
    );

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    await Promise.all(
      mockWaitUntil.mock.calls.map(([p]: [Promise<unknown>]) => p.catch(() => {})),
    );

    expect(mockReconcile).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-no-usage",
      expect.any(Array),
      0,
    );
  });

  // --- Multiple entities ---

  it("passes both key and user entity keys to checkAndReserve", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity, userEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-multi",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    expect(mockCheckAndReserve).toHaveBeenCalledWith(
      expect.anything(),
      ["{budget}:api_key:key-uuid-123", "{budget}:user:user-uuid-456"],
      500_000,
    );
  });

  // --- updateBudgetSpend assertions ---

  it("updateBudgetSpend called with correct entities and cost on non-streaming success", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-spend-check",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    await Promise.all(
      mockWaitUntil.mock.calls.map(([p]: [Promise<unknown>]) => p.catch(() => {})),
    );

    expect(mockUpdateBudgetSpend).toHaveBeenCalledWith(
      expect.any(String),
      [{ entityType: "api_key", entityId: "key-uuid-123" }],
      expect.any(Number),
    );
    const calledCost = mockUpdateBudgetSpend.mock.calls[0][2] as number;
    expect(calledCost).toBeGreaterThan(0);
  });

  it("updateBudgetSpend NOT called when actualCost=0 (upstream error path)", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-no-spend",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "bad request" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    await Promise.all(
      mockWaitUntil.mock.calls.map(([p]: [Promise<unknown>]) => p.catch(() => {})),
    );

    expect(mockUpdateBudgetSpend).not.toHaveBeenCalled();
  });

  it("estimateMaxCost receives correct model string as first argument", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-model-check",
    });
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), defaultBody);

    expect(mockEstimateMaxCost).toHaveBeenCalledWith("gpt-4o-mini", defaultBody);
  });
});
