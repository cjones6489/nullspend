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
  mockReconcileReservation,
} = vi.hoisted(() => ({
  mockWaitUntil: vi.fn((promise: Promise<unknown>) => { promise.catch(() => {}); }),
  mockLookupBudgets: vi.fn(),
  mockCheckAndReserve: vi.fn(),
  mockReconcile: vi.fn(),
  mockEstimateMaxCost: vi.fn(),
  mockUpdateBudgetSpend: vi.fn(),
  mockCalculateOpenAICost: vi.fn(),
  mockReconcileReservation: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: mockWaitUntil,
}));

vi.mock("@nullspend/cost-engine", () => ({
  isKnownModel: vi.fn().mockReturnValue(true),
  getModelPricing: vi.fn().mockReturnValue({
    inputPerMTok: 2.50, cachedInputPerMTok: 1.25, outputPerMTok: 10.00,
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

vi.mock("../lib/budget-reconcile.js", () => ({
  reconcileReservation: (...args: unknown[]) => mockReconcileReservation(...args),
}));

vi.mock("@upstash/redis/cloudflare", () => ({
  Redis: { fromEnv: vi.fn(() => ({})) },
}));

vi.mock("../lib/sanitize-upstream-error.js", () => ({
  sanitizeUpstreamError: vi.fn().mockResolvedValue(JSON.stringify({
    error: { type: "upstream_error", message: "bad" }
  })),
}));

import { handleChatCompletions } from "../routes/openai.js";
import type { RequestContext } from "../lib/context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function makeEnv(): Env {
  return {
    OPENAI_API_KEY: "sk-test-key",
    HYPERDRIVE: { connectionString: "postgresql://postgres:postgres@db.example.com:5432/postgres" },
    UPSTASH_REDIS_REST_URL: "https://fake.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "fake-token",
  } as Env;
}

function makeCtx(
  body: Record<string, unknown>,
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    body,
    auth: { userId: "user-uuid-456", keyId: "a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e40001", hasBudgets: true },
    redis: {} as any,
    connectionString: "postgresql://postgres:postgres@db.example.com:5432/postgres",
    sessionId: null,
    ...overrides,
  };
}

async function drainWaitUntil() {
  await Promise.all(
    mockWaitUntil.mock.calls.map(([p]: [Promise<unknown>]) => p.catch(() => {})),
  );
}

const defaultBody = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] };

const budgetEntity = {
  entityKey: "{budget}:api_key:key-uuid-123",
  entityType: "api_key",
  entityId: "key-uuid-123",
  maxBudget: 50_000_000,
  spend: 10_000_000,
  reserved: 0,
  policy: "strict_block",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("upstream timeout / error — reservation cleanup", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReconcileReservation.mockResolvedValue(undefined);
    mockReconcile.mockResolvedValue({ status: "reconciled" });
    mockUpdateBudgetSpend.mockResolvedValue(undefined);
    mockEstimateMaxCost.mockReturnValue(500_000);
    mockCalculateOpenAICost.mockReturnValue({ costMicrodollars: 42_000 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("upstream fetch timeout triggers reservation cleanup", async () => {
    mockLookupBudgets.mockResolvedValue([budgetEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-timeout",
    });

    globalThis.fetch = vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted", "AbortError"),
    );

    await expect(
      handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody)),
    ).rejects.toThrow();

    await drainWaitUntil();

    expect(mockReconcileReservation).toHaveBeenCalledWith(
      expect.anything(),          // redis
      "rsv-timeout",              // reservationId
      0,                          // actualCost
      [budgetEntity],             // budgetEntities
      "postgresql://postgres:postgres@db.example.com:5432/postgres", // connString
    );
  });

  it("upstream network error triggers reservation cleanup", async () => {
    mockLookupBudgets.mockResolvedValue([budgetEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-timeout",
    });

    globalThis.fetch = vi.fn().mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    await expect(
      handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody)),
    ).rejects.toThrow();

    await drainWaitUntil();

    expect(mockReconcileReservation).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-timeout",
      0,
      [budgetEntity],
      "postgresql://postgres:postgres@db.example.com:5432/postgres",
    );
  });

  it("no reservation — timeout does NOT attempt reconciliation", async () => {
    mockLookupBudgets.mockResolvedValue([]);

    globalThis.fetch = vi.fn().mockRejectedValue(
      new DOMException("The operation was aborted", "AbortError"),
    );

    await expect(
      handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody)),
    ).rejects.toThrow();

    await drainWaitUntil();

    expect(mockReconcileReservation).not.toHaveBeenCalled();
  });

  it("upstream 4xx error — reservation reconciled with cost=0", async () => {
    mockLookupBudgets.mockResolvedValue([budgetEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-4xx",
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { type: "invalid_request", message: "bad model" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody));
    await drainWaitUntil();

    expect(response.status).toBe(400);
    expect(mockReconcileReservation).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-4xx",
      0,
      [budgetEntity],
      "postgresql://postgres:postgres@db.example.com:5432/postgres",
    );
  });

  it("upstream 5xx error — reservation reconciled with cost=0", async () => {
    mockLookupBudgets.mockResolvedValue([budgetEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-5xx",
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { type: "server_error", message: "internal" } }),
        { status: 500, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody));
    await drainWaitUntil();

    expect(response.status).toBe(500);
    expect(mockReconcileReservation).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-5xx",
      0,
      [budgetEntity],
      "postgresql://postgres:postgres@db.example.com:5432/postgres",
    );
  });

  it("successful response — reservation reconciled with actual cost", async () => {
    mockLookupBudgets.mockResolvedValue([budgetEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-success",
    });
    mockCalculateOpenAICost.mockReturnValue({ costMicrodollars: 75_000 });

    const successBody = {
      id: "chatcmpl-abc",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(successBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await handleChatCompletions(makeRequest(defaultBody), makeEnv(), makeCtx(defaultBody));
    await drainWaitUntil();

    expect(response.status).toBe(200);
    expect(mockReconcileReservation).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-success",
      75_000,
      [budgetEntity],
      "postgresql://postgres:postgres@db.example.com:5432/postgres",
    );
  });
});
