import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { getDb } from "@/lib/db/client";
import { GET } from "./route";

vi.mock("@/lib/auth/with-api-key-auth", () => ({
  authenticateApiKey: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@nullspend/cost-engine", () => ({
  getAllPricing: vi.fn(() => ({
    "openai/gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10, cachedInputPerMTok: 1.25 },
    "openai/gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6, cachedInputPerMTok: 0.075 },
    "anthropic/claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3 },
  })),
}));

vi.mock("@/lib/observability", () => ({
  withRequestContext: vi.fn((handler) => handler),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);
const mockedGetDb = vi.mocked(getDb);

// Far-future reference date so monthly periods are never accidentally expired.
// Using 2099 ensures this test never suffers from date drift.
const FIXED_NOW = new Date("2099-06-15T12:00:00Z").getTime();

function makeRequest() {
  return new Request("http://localhost/api/policy", {
    headers: { "x-nullspend-key": "ns_live_sk_test0001" },
  });
}

function makeBudgetRow(overrides: Record<string, unknown> = {}) {
  return {
    entityType: "api_key",
    entityId: "key-1",
    maxBudgetMicrodollars: 10_000_000,
    spendMicrodollars: 2_500_000,
    resetInterval: "monthly",
    currentPeriodStart: new Date("2099-06-01T00:00:00Z"),
    sessionLimitMicrodollars: null as number | null,
    ...overrides,
  };
}

function mockDbWithBudgets(rows: ReturnType<typeof makeBudgetRow>[]) {
  const mockWhere = vi.fn().mockResolvedValue(rows);
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  mockedGetDb.mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof getDb>);
}

function defaultAuthContext(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    orgId: "org-test-1",
    keyId: "key-1",
    apiVersion: "2026-04-01",
    allowedModels: null,
    allowedProviders: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("GET /api/policy", () => {
  it("returns auth error when API key is invalid", async () => {
    const authResponse = new Response(
      JSON.stringify({ error: { code: "authentication_required", message: "Invalid or missing API key.", details: null } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
    mockedAuthenticateApiKey.mockResolvedValue(authResponse);

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("authentication_required");
  });

  it("returns 403 when orgId is null", async () => {
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext({ orgId: null }) as any);

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("configuration_error");
    expect(body.error.message).toContain("not associated with an organization");
  });

  it("returns most restrictive budget (lowest remaining)", async () => {
    vi.useFakeTimers({ now: FIXED_NOW });
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([
      makeBudgetRow({
        entityId: "key-1",
        maxBudgetMicrodollars: 10_000_000,
        spendMicrodollars: 2_000_000,  // remaining: 8M
      }),
      makeBudgetRow({
        entityType: "tag",
        entityId: "env=prod",
        maxBudgetMicrodollars: 5_000_000,
        spendMicrodollars: 4_000_000,  // remaining: 1M — most restrictive
      }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.budget).not.toBeNull();
    expect(body.budget.remaining_microdollars).toBe(1_000_000);
    expect(body.budget.max_microdollars).toBe(5_000_000);
    expect(body.budget.spend_microdollars).toBe(4_000_000);
    expect(body.budget.entity_type).toBe("tag");
    expect(body.budget.entity_id).toBe("env=prod");
  });

  it("returns budget: null when no budgets exist", async () => {
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.budget).toBeNull();
  });

  it("passes through allowedModels and allowedProviders from key", async () => {
    mockedAuthenticateApiKey.mockResolvedValue(
      defaultAuthContext({
        allowedModels: ["gpt-4o-mini"],
        allowedProviders: ["openai"],
      }) as any,
    );
    mockDbWithBudgets([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.allowed_models).toEqual(["gpt-4o-mini"]);
    expect(body.allowed_providers).toEqual(["openai"]);
    expect(body.restrictions_active).toBe(true);
  });

  it("sets restrictions_active to false when no restrictions", async () => {
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.restrictions_active).toBe(false);
    expect(body.allowed_models).toBeNull();
    expect(body.allowed_providers).toBeNull();
  });

  it("returns cheapest models filtered by allowed models and providers", async () => {
    mockedAuthenticateApiKey.mockResolvedValue(
      defaultAuthContext({
        allowedModels: ["gpt-4o-mini"],
        allowedProviders: ["openai"],
      }) as any,
    );
    mockDbWithBudgets([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    // Only gpt-4o-mini should appear (filtered by both allowedModels and allowedProviders)
    expect(body.cheapest_overall).not.toBeNull();
    expect(body.cheapest_overall.model).toBe("gpt-4o-mini");
    expect(body.cheapest_per_provider).not.toBeNull();
    expect(body.cheapest_per_provider.openai.model).toBe("gpt-4o-mini");
    // Anthropic should not appear
    expect(body.cheapest_per_provider.anthropic).toBeUndefined();
  });

  it("returns null cheapest when no models match allowed list", async () => {
    mockedAuthenticateApiKey.mockResolvedValue(
      defaultAuthContext({
        allowedModels: ["nonexistent-model"],
        allowedProviders: ["openai"],
      }) as any,
    );
    mockDbWithBudgets([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.cheapest_overall).toBeNull();
    expect(body.cheapest_per_provider).toBeNull();
  });

  it("computes period_end from reset interval", async () => {
    vi.useFakeTimers({ now: FIXED_NOW });
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([
      makeBudgetRow({
        resetInterval: "monthly",
        currentPeriodStart: new Date("2099-06-01T00:00:00Z"),
      }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.budget.period_end).toBe("2099-07-01T00:00:00.000Z");
  });

  it("returns period_end null when no reset interval", async () => {
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([
      makeBudgetRow({ resetInterval: null, currentPeriodStart: null }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.budget.period_end).toBeNull();
  });

  it("sets Cache-Control: no-store header", async () => {
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([]);

    const res = await GET(makeRequest());

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 500 with error response on DB error", async () => {
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);

    const mockWhere = vi.fn().mockRejectedValue(new Error("connection refused"));
    const mockFrom = vi.fn(() => ({ where: mockWhere }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));
    mockedGetDb.mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof getDb>);

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).toBe("Failed to retrieve policy");
  });

  it("clamps remaining_microdollars to zero when overspent", async () => {
    vi.useFakeTimers({ now: FIXED_NOW });
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([
      makeBudgetRow({
        maxBudgetMicrodollars: 5_000_000,
        spendMicrodollars: 7_000_000,  // overspent by 2M
      }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.budget.remaining_microdollars).toBe(0);
    expect(body.budget.spend_microdollars).toBe(7_000_000);
  });

  it("treats expired period budget as fully available (spend=0)", async () => {
    vi.useFakeTimers({ now: FIXED_NOW });
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    // Daily budget with period start 2 days ago → period ended yesterday
    mockDbWithBudgets([
      makeBudgetRow({
        resetInterval: "daily",
        currentPeriodStart: new Date(FIXED_NOW - 2 * 24 * 60 * 60 * 1000),
        maxBudgetMicrodollars: 10_000_000,
        spendMicrodollars: 9_500_000,  // 95% spent — but period expired
      }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    // Expired period → spend treated as 0, remaining = max
    expect(body.budget.remaining_microdollars).toBe(10_000_000);
    expect(body.budget.spend_microdollars).toBe(0);
    // period_end should be computed from "now" (start of new period)
    expect(body.budget.period_end).not.toBeNull();
  });

  it("does NOT reset spend for non-expired period", async () => {
    vi.useFakeTimers({ now: FIXED_NOW });
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    // Monthly budget started today → period NOT expired
    mockDbWithBudgets([
      makeBudgetRow({
        resetInterval: "monthly",
        currentPeriodStart: new Date(FIXED_NOW),
        maxBudgetMicrodollars: 10_000_000,
        spendMicrodollars: 5_000_000,
      }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.budget.remaining_microdollars).toBe(5_000_000);
    expect(body.budget.spend_microdollars).toBe(5_000_000);
  });

  // -------------------------------------------------------------------------
  // Session limit
  // -------------------------------------------------------------------------

  it("computes period_end for yearly reset interval", async () => {
    vi.useFakeTimers({ now: FIXED_NOW });
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([
      makeBudgetRow({
        resetInterval: "yearly",
        currentPeriodStart: new Date("2099-01-01T00:00:00Z"),
      }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.budget.period_end).toBe("2100-01-01T00:00:00.000Z");
  });

  it("includes session_limit_microdollars from budget row", async () => {
    vi.useFakeTimers({ now: FIXED_NOW });
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([
      makeBudgetRow({ sessionLimitMicrodollars: 500_000 }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session_limit_microdollars).toBe(500_000);
  });

  it("returns session_limit_microdollars null when no session limit set", async () => {
    vi.useFakeTimers({ now: FIXED_NOW });
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([
      makeBudgetRow({ sessionLimitMicrodollars: null }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session_limit_microdollars).toBeNull();
  });

  it("returns minimum session_limit_microdollars across multiple budgets", async () => {
    vi.useFakeTimers({ now: FIXED_NOW });
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([
      makeBudgetRow({ entityId: "key-1", sessionLimitMicrodollars: 1_000_000 }),
      makeBudgetRow({ entityType: "tag", entityId: "env=prod", sessionLimitMicrodollars: 200_000 }),
      makeBudgetRow({ entityType: "tag", entityId: "env=dev", sessionLimitMicrodollars: null }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session_limit_microdollars).toBe(200_000);
  });

  it("returns session_limit_microdollars: 0 when budget has zero limit (block-all)", async () => {
    vi.useFakeTimers({ now: FIXED_NOW });
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([
      makeBudgetRow({ sessionLimitMicrodollars: 0 }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session_limit_microdollars).toBe(0);
  });

  it("returns session_limit_microdollars null when no budgets exist", async () => {
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session_limit_microdollars).toBeNull();
  });

  it("always includes session_limit_microdollars key in response (even when budget is null)", async () => {
    mockedAuthenticateApiKey.mockResolvedValue(defaultAuthContext() as any);
    mockDbWithBudgets([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.budget).toBeNull();
    expect("session_limit_microdollars" in body).toBe(true);
  });
});
