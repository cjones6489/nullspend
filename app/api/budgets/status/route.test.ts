import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateApiKey, applyRateLimitHeaders } from "@/lib/auth/with-api-key-auth";
import { GET } from "./route";

vi.mock("@/lib/auth/with-api-key-auth", () => ({
  authenticateApiKey: vi.fn(),
  applyRateLimitHeaders: vi.fn((res: Response) => res),
}));

const mockWhere = vi.fn().mockResolvedValue([]);
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({ select: mockSelect })),
}));

vi.mock("@/lib/observability", () => ({
  withRequestContext: vi.fn(
    (handler: (req: Request) => Promise<Response>) => handler,
  ),
}));

const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);
const mockedApplyRateLimitHeaders = vi.mocked(applyRateLimitHeaders);

function makeRequest(): Request {
  return new Request("http://localhost:3000/api/budgets/status", {
    method: "GET",
    headers: { "x-nullspend-key": "ns_live_sk_test0001" },
  });
}

function makeBudgetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "b-1",
    entityType: "user",
    entityId: "user-1",
    maxBudgetMicrodollars: 10_000_000,
    spendMicrodollars: 3_000_000,
    policy: "strict_block",
    resetInterval: "monthly",
    thresholdPercentages: [50, 80, 90, 95],
    velocityLimitMicrodollars: null,
    velocityWindowSeconds: 60,
    velocityCooldownSeconds: 60,
    currentPeriodStart: new Date("2026-03-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-03-01T00:00:00Z"),
    ...overrides,
  };
}

/** Recursively extract string chunks from a Drizzle SQL object. */
function flattenStringChunks(sql: any): string[] {
  if (!sql?.queryChunks) return [];
  const results: string[] = [];
  for (const chunk of sql.queryChunks) {
    if (chunk?.value) results.push(...chunk.value);
    if (chunk?.queryChunks) results.push(...flattenStringChunks(chunk));
  }
  return results;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/budgets/status", () => {
  it("returns budget entities for authenticated key (user + api_key budgets)", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockWhere.mockResolvedValue([
      makeBudgetRow(),
      makeBudgetRow({
        id: "b-2",
        entityType: "api_key",
        entityId: "key-1",
        maxBudgetMicrodollars: 5_000_000,
        spendMicrodollars: 1_000_000,
      }),
    ]);

    const res = await GET(makeRequest());
    const json = await res.json();


    expect(json.entities).toHaveLength(2);
    expect(json.entities[0].entityType).toBe("user");
    expect(json.entities[1].entityType).toBe("api_key");
  });

  it("returns empty entities when no budgets exist", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockWhere.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const json = await res.json();


    expect(json.entities).toEqual([]);
  });

  it("maps maxBudgetMicrodollars to limitMicrodollars", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockWhere.mockResolvedValue([
      makeBudgetRow({ maxBudgetMicrodollars: 50_000_000 }),
    ]);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.entities[0].limitMicrodollars).toBe(50_000_000);
    // Should NOT have maxBudgetMicrodollars in response
    expect(json.entities[0].maxBudgetMicrodollars).toBeUndefined();
  });

  it("computes spendMicrodollars and remainingMicrodollars correctly", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockWhere.mockResolvedValue([
      makeBudgetRow({
        maxBudgetMicrodollars: 10_000_000,
        spendMicrodollars: 3_000_000,
      }),
    ]);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.entities[0].spendMicrodollars).toBe(3_000_000);
    expect(json.entities[0].remainingMicrodollars).toBe(7_000_000);
  });

  it("returns 401 without API key", async () => {
    const authError = new Response(
      JSON.stringify({ error: { code: "authentication_required", message: "authentication_required", details: null } }),
      { status: 401 },
    );
    mockedAuthenticateApiKey.mockResolvedValue(authError);

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    const rateLimitResponse = new Response(
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "rate_limit_exceeded", details: null } }),
      { status: 429 },
    );
    mockedAuthenticateApiKey.mockResolvedValue(rateLimitResponse);

    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
  });

  it("queries only user budgets in dev-mode (keyId null) — no or() in WHERE", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: null,
      apiVersion: "2026-04-01",
    });
    mockWhere.mockResolvedValue([makeBudgetRow()]);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.entities).toHaveLength(1);
    // Verify the WHERE condition does not contain " or " (only " and ")
    const condition = mockWhere.mock.calls[0][0];
    const chunks = flattenStringChunks(condition);
    expect(chunks).not.toContain(" or ");
    expect(chunks).toContain(" and ");
  });

  it("clamps remainingMicrodollars to 0 when overspent", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockWhere.mockResolvedValue([
      makeBudgetRow({
        maxBudgetMicrodollars: 5_000_000,
        spendMicrodollars: 8_000_000,
      }),
    ]);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.entities[0].remainingMicrodollars).toBe(0);
    expect(json.entities[0].spendMicrodollars).toBe(8_000_000);
  });

  it("serializes currentPeriodStart as ISO string; null when no reset interval", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockWhere.mockResolvedValue([
      makeBudgetRow({
        resetInterval: "monthly",
        currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
      }),
      makeBudgetRow({
        id: "b-2",
        entityType: "api_key",
        entityId: "key-1",
        resetInterval: null,
        currentPeriodStart: null,
      }),
    ]);

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json.entities[0].currentPeriodStart).toBe("2026-03-01T00:00:00.000Z");
    expect(json.entities[1].currentPeriodStart).toBeNull();
  });

  it("includes thresholdPercentages in status response", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    mockWhere.mockResolvedValue([
      makeBudgetRow({ thresholdPercentages: [25, 75] }),
    ]);

    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.entities[0].thresholdPercentages).toEqual([25, 75]);
  });

  it("applies rate limit headers via applyRateLimitHeaders", async () => {
    const rateLimit = { limit: 100, remaining: 99, reset: 1710720000000 };
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-1",
      keyId: "key-1",
      apiVersion: "2026-04-01",
      rateLimit,
    });
    mockWhere.mockResolvedValue([]);

    await GET(makeRequest());

    expect(mockedApplyRateLimitHeaders).toHaveBeenCalledWith(
      expect.any(Response),
      rateLimit,
    );
  });
});
