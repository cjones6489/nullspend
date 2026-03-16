/**
 * Streaming + Budget Integration Tests
 *
 * Verifies that streaming requests properly interact with the budget
 * lifecycle: reservation, reconciliation with actual cost, and
 * updateBudgetSpend assertions.
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

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    OPENAI_API_KEY: "sk-test-key",
    HYPERDRIVE: {
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    },
    UPSTASH_REDIS_REST_URL: "https://fake.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "fake-token",
    ...overrides,
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

const streamBody = {
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "hi" }],
  stream: true,
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

const sseWithUsage = [
  'data: {"id":"chatcmpl-1","model":"gpt-4o-mini","choices":[{"delta":{"content":"hi"}}]}\n\n',
  'data: {"id":"chatcmpl-1","model":"gpt-4o-mini","choices":[],"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n',
  "data: [DONE]\n\n",
];

const sseWithoutUsage = [
  'data: {"id":"chatcmpl-1","model":"gpt-4o-mini","choices":[{"delta":{"content":"hi"}}]}\n\n',
  "data: [DONE]\n\n",
];

describe("Streaming + Budget Integration", () => {
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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("streaming success with usage reconciles with actual cost > 0", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-stream-1" });
    mockCalculateOpenAICost.mockReturnValue({ costMicrodollars: 42_000 });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeSSEStream(sseWithUsage), {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-request-id": "req-s1" },
      }),
    );

    const res = await handleChatCompletions(makeRequest(streamBody), makeEnv(), makeCtx(streamBody));
    expect(res.status).toBe(200);
    await res.text();
    await drainWaitUntil();

    expect(mockReconcile).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-stream-1",
      ["{budget}:api_key:key-uuid-123"],
      42_000,
    );
  });

  it("streaming success with usage triggers updateBudgetSpend", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-stream-spend" });
    mockCalculateOpenAICost.mockReturnValue({ costMicrodollars: 75_000 });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeSSEStream(sseWithUsage), {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-request-id": "req-s2" },
      }),
    );

    const res = await handleChatCompletions(makeRequest(streamBody), makeEnv(), makeCtx(streamBody));
    expect(res.status).toBe(200);
    await res.text();
    await drainWaitUntil();

    expect(mockUpdateBudgetSpend).toHaveBeenCalledWith(
      expect.any(String),
      [{ entityType: "api_key", entityId: "key-uuid-123" }],
      75_000,
    );
  });

  it("streaming success without usage reconciles with actualCost=0", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-no-usage" });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeSSEStream(sseWithoutUsage), {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-request-id": "req-s3" },
      }),
    );

    const res = await handleChatCompletions(makeRequest(streamBody), makeEnv(), makeCtx(streamBody));
    expect(res.status).toBe(200);
    await res.text();
    await drainWaitUntil();

    expect(mockReconcile).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-no-usage",
      ["{budget}:api_key:key-uuid-123"],
      0,
    );
  });

  it("streaming without usage does NOT call updateBudgetSpend", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-no-spend" });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeSSEStream(sseWithoutUsage), {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-request-id": "req-s4" },
      }),
    );

    const res = await handleChatCompletions(makeRequest(streamBody), makeEnv(), makeCtx(streamBody));
    expect(res.status).toBe(200);
    await res.text();
    await drainWaitUntil();

    expect(mockUpdateBudgetSpend).not.toHaveBeenCalled();
  });

  it("streaming with null upstream body returns 502 and reconciles with 0", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-null-body" });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-request-id": "req-s5" },
      }),
    );

    const res = await handleChatCompletions(makeRequest(streamBody), makeEnv(), makeCtx(streamBody));
    expect(res.status).toBe(502);
    await drainWaitUntil();

    expect(mockReconcile).toHaveBeenCalledWith(
      expect.anything(),
      "rsv-null-body",
      ["{budget}:api_key:key-uuid-123"],
      0,
    );
  });

  it("streaming cost calculation failure still reconciles with 0 (last-resort)", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-cost-err" });
    mockCalculateOpenAICost.mockImplementation(() => {
      throw new Error("cost calc explosion");
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeSSEStream(sseWithUsage), {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-request-id": "req-s6" },
      }),
    );

    const res = await handleChatCompletions(makeRequest(streamBody), makeEnv(), makeCtx(streamBody));
    expect(res.status).toBe(200);
    await res.text();
    await drainWaitUntil();

    const reconcileCalls = mockReconcile.mock.calls;
    expect(reconcileCalls.length).toBeGreaterThanOrEqual(1);
    const lastCall = reconcileCalls[reconcileCalls.length - 1];
    expect(lastCall[3]).toBe(0);
  });

  it("streaming + budget denied returns 429", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "denied",
      entityKey: "{budget}:api_key:key-uuid-123",
      remaining: 100_000,
      maxBudget: 50_000_000,
      spend: 49_400_000,
    });

    const res = await handleChatCompletions(makeRequest(streamBody), makeEnv(), makeCtx(streamBody));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
  });

  it("streaming + no budget configured passes through without budget calls", async () => {
    mockLookupBudgets.mockResolvedValue([]);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeSSEStream(sseWithUsage), {
        status: 200,
        headers: { "content-type": "text/event-stream", "x-request-id": "req-s8" },
      }),
    );

    const res = await handleChatCompletions(makeRequest(streamBody), makeEnv(), makeCtx(streamBody));
    expect(res.status).toBe(200);
    await res.text();

    expect(mockCheckAndReserve).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockUpdateBudgetSpend).not.toHaveBeenCalled();
  });
});
