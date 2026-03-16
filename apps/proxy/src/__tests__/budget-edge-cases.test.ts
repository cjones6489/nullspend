/**
 * Budget Edge Case Tests
 *
 * Tests numeric edge cases, attribution nulls, updateBudgetSpend conditional
 * invocation, 429 response body structure, and sensitive data leakage through
 * the full handleChatCompletions flow.
 */
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

const {
  mockWaitUntil,
  mockLookupBudgets,
  mockCheckAndReserve,
  mockReconcile,
  mockEstimateMaxCost,
  mockUpdateBudgetSpend,
  mockCalculateOpenAICost,
} = vi.hoisted(() => ({
  mockWaitUntil: vi.fn((promise: Promise<unknown>) => { promise.catch(() => {}); }),
  mockLookupBudgets: vi.fn(),
  mockCheckAndReserve: vi.fn(),
  mockReconcile: vi.fn(),
  mockEstimateMaxCost: vi.fn(),
  mockUpdateBudgetSpend: vi.fn(),
  mockCalculateOpenAICost: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: mockWaitUntil,
}));

vi.mock("@nullspend/cost-engine", () => ({
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

vi.mock("../lib/cost-calculator.js", () => ({
  calculateOpenAICost: (...args: unknown[]) => mockCalculateOpenAICost(...args),
}));

vi.mock("@upstash/redis/cloudflare", () => ({
  Redis: {
    fromEnv: vi.fn(() => ({})),
  },
}));

import { handleChatCompletions } from "../routes/openai.js";
import type { RequestContext } from "../lib/context.js";

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

async function drainWaitUntil() {
  await Promise.all(
    mockWaitUntil.mock.calls.map(([p]: [Promise<unknown>]) => p.catch(() => {})),
  );
}

function makeCtx(
  body: Record<string, unknown>,
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    body,
    auth: { userId: "user-uuid-456", keyId: "a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e40001", hasBudgets: true, hasWebhooks: false },
    redis: {} as any,
    connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    sessionId: null,
    webhookDispatcher: null,
    ...overrides,
  };
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

describe("Budget Edge Cases", () => {
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
    mockCalculateOpenAICost.mockReset();
    mockReconcile.mockResolvedValue({ status: "reconciled", spends: {} });
    mockUpdateBudgetSpend.mockResolvedValue(undefined);
    mockEstimateMaxCost.mockReturnValue(500_000);
    mockCalculateOpenAICost.mockReturnValue({ costMicrodollars: 42_000 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // --- Attribution nulls ---

  it("passes { keyId: null, userId } when auth result has no keyId", async () => {
    mockLookupBudgets.mockResolvedValue([]);
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody, {
      auth: { userId: "user-uuid-456", keyId: null as any, hasBudgets: true, hasWebhooks: false },
    }));

    expect(mockLookupBudgets).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      { keyId: null, userId: "user-uuid-456" },
    );
  });

  it("passes { keyId, userId: null } when auth result has no userId", async () => {
    mockLookupBudgets.mockResolvedValue([]);
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody, {
      auth: { userId: null as any, keyId: "a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e40001", hasBudgets: true, hasWebhooks: false },
    }));

    expect(mockLookupBudgets).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      { keyId: "a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e40001", userId: null },
    );
  });

  it("passes { keyId: null, userId: null } when auth result has neither", async () => {
    mockLookupBudgets.mockResolvedValue([]);
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody, {
      auth: { userId: null as any, keyId: null as any, hasBudgets: true, hasWebhooks: false },
    }));

    expect(mockLookupBudgets).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      { keyId: null, userId: null },
    );
    expect(mockCheckAndReserve).not.toHaveBeenCalled();
  });

  // --- Zero estimate ---

  it("zero estimate still calls checkAndReserve with estimate=0", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockEstimateMaxCost.mockReturnValue(0);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-zero" });
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody));

    expect(mockCheckAndReserve).toHaveBeenCalledWith(
      expect.anything(),
      ["{budget}:api_key:key-uuid-123"],
      0,
    );
  });

  // --- updateBudgetSpend called with correct args ---

  it("updateBudgetSpend called with correct entities and cost on non-streaming success", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-spend" });
    mockCalculateOpenAICost.mockReturnValue({ costMicrodollars: 123_456 });
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody));
    await drainWaitUntil();

    expect(mockUpdateBudgetSpend).toHaveBeenCalledWith(
      expect.any(String),
      [{ entityType: "api_key", entityId: "key-uuid-123" }],
      123_456,
    );
  });

  it("updateBudgetSpend NOT called when upstream returns error (actualCost=0)", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-err" });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "bad" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody));
    await drainWaitUntil();

    expect(mockUpdateBudgetSpend).not.toHaveBeenCalled();
  });

  it("updateBudgetSpend NOT called when no budget configured", async () => {
    mockLookupBudgets.mockResolvedValue([]);
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    await handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody));
    await drainWaitUntil();

    expect(mockUpdateBudgetSpend).not.toHaveBeenCalled();
  });

  // --- 429 response body structure ---

  it("429 response body contains all required fields", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockEstimateMaxCost.mockReturnValue(999_999);
    mockCheckAndReserve.mockResolvedValue({
      status: "denied",
      entityKey: "{budget}:api_key:key-uuid-123",
      remaining: 100_000,
      maxBudget: 50_000_000,
      spend: 49_400_000,
    });

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody));
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
    expect(body.message).toBe("Request blocked: estimated cost exceeds remaining budget");
    expect(body.details).toBeUndefined();
  });

  it("429 response does not contain sensitive data", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "denied",
      entityKey: "{budget}:api_key:key-uuid-123",
      remaining: 0,
      maxBudget: 50_000_000,
      spend: 50_000_000,
    });

    const res = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody));
    const text = await res.text();

    expect(text).not.toContain("test-platform-key");
    expect(text).not.toContain("x-nullspend-auth");
    expect(text).not.toContain("postgresql://");
    expect(text).not.toContain("upstash.io");
    expect(text).not.toContain("fake-token");
  });

  // --- Model passed correctly ---

  it("estimateMaxCost receives correct model string from body", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-model" });
    globalThis.fetch = vi.fn().mockResolvedValue(makeSuccessResponse());

    const body = { model: "o3-mini", messages: [{ role: "user", content: "think" }] };
    await handleChatCompletions(makeRequest(body), makeEnv(), makeCtx(body));

    expect(mockEstimateMaxCost).toHaveBeenCalledWith("o3-mini", body);
  });
});
