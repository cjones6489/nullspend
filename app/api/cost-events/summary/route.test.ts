import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";
import {
  getCostBreakdownTotals,
  getDailySpend,
  getKeyBreakdown,
  getModelBreakdown,
  getProviderBreakdown,
  getSourceBreakdown,
  getToolBreakdown,
  getTraceBreakdown,
  getTotals,
} from "@/lib/cost-events/aggregate-cost-events";
import { GET } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

vi.mock("@/lib/cost-events/aggregate-cost-events", () => ({
  getCostBreakdownTotals: vi.fn(),
  getDailySpend: vi.fn(),
  getModelBreakdown: vi.fn(),
  getProviderBreakdown: vi.fn(),
  getSourceBreakdown: vi.fn(),
  getKeyBreakdown: vi.fn(),
  getToolBreakdown: vi.fn(),
  getTraceBreakdown: vi.fn(),
  getTotals: vi.fn(),
}));

const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);
const mockedGetCostBreakdownTotals = vi.mocked(getCostBreakdownTotals);
const mockedGetDailySpend = vi.mocked(getDailySpend);
const mockedGetModelBreakdown = vi.mocked(getModelBreakdown);
const mockedGetProviderBreakdown = vi.mocked(getProviderBreakdown);
const mockedGetKeyBreakdown = vi.mocked(getKeyBreakdown);
const mockedGetToolBreakdown = vi.mocked(getToolBreakdown);
const mockedGetSourceBreakdown = vi.mocked(getSourceBreakdown);
const mockedGetTraceBreakdown = vi.mocked(getTraceBreakdown);
const mockedGetTotals = vi.mocked(getTotals);

const MOCK_USER_ID = "user-abc-123";

const mockDailyData = [
  { date: "2026-03-07", totalCostMicrodollars: 5_000_000 },
  { date: "2026-03-08", totalCostMicrodollars: 3_000_000 },
];

const mockModelData = [
  {
    provider: "openai",
    model: "gpt-4o",
    totalCostMicrodollars: 6_000_000,
    requestCount: 15,
    inputTokens: 30000,
    outputTokens: 8000,
    cachedInputTokens: 2000,
    reasoningTokens: 0,
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    totalCostMicrodollars: 2_000_000,
    requestCount: 25,
    inputTokens: 20000,
    outputTokens: 5000,
    cachedInputTokens: 1000,
    reasoningTokens: 0,
  },
];

const mockProviderData = [
  { provider: "openai", totalCostMicrodollars: 8_000_000, requestCount: 40 },
];

const mockKeyData = [
  {
    apiKeyId: "550e8400-e29b-41d4-a716-446655440000",
    keyName: "Production Key",
    totalCostMicrodollars: 8_000_000,
    requestCount: 40,
  },
];

const mockTotals = {
  totalCostMicrodollars: 8_000_000,
  totalRequests: 40,
};

const mockSourceData = [
  { source: "proxy" as const, totalCostMicrodollars: 8_000_000, requestCount: 40 },
];

const mockCostBreakdown = {
  inputCost: 2_000_000,
  outputCost: 5_000_000,
  cachedCost: 1_000_000,
  reasoningCost: 0,
};

function setupMocks() {
  mockedResolveSessionUserId.mockResolvedValue(MOCK_USER_ID);
  mockedGetDailySpend.mockResolvedValue(mockDailyData);
  mockedGetModelBreakdown.mockResolvedValue(mockModelData);
  mockedGetProviderBreakdown.mockResolvedValue(mockProviderData);
  mockedGetKeyBreakdown.mockResolvedValue(mockKeyData);
  mockedGetToolBreakdown.mockResolvedValue([]);
  mockedGetSourceBreakdown.mockResolvedValue(mockSourceData);
  mockedGetTraceBreakdown.mockResolvedValue([]);
  mockedGetTotals.mockResolvedValue(mockTotals);
  mockedGetCostBreakdownTotals.mockResolvedValue(mockCostBreakdown);
}

describe("GET /api/cost-events/summary", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 200 with aggregated data for default period", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/summary");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.daily).toEqual(mockDailyData);
    expect(body.models).toEqual(mockModelData);
    expect(body.providers).toEqual(mockProviderData);
    expect(body.keys).toEqual([
      {
        ...mockKeyData[0],
        apiKeyId: "ns_key_550e8400-e29b-41d4-a716-446655440000",
      },
    ]);
    expect(body.tools).toEqual([]);
    expect(body.sources).toEqual(mockSourceData);
    expect(body.costBreakdown).toEqual(mockCostBreakdown);
    expect(body.totals.totalCostMicrodollars).toBe(8_000_000);
    expect(body.totals.totalRequests).toBe(40);
    expect(body.totals.period).toBe("30d");
  });

  it("uses default period 30d when no query param provided", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/summary");
    await GET(req);

    expect(mockedGetDailySpend).toHaveBeenCalledWith(MOCK_USER_ID, 30, undefined);
    expect(mockedGetModelBreakdown).toHaveBeenCalledWith(MOCK_USER_ID, 30, undefined);
    expect(mockedGetKeyBreakdown).toHaveBeenCalledWith(MOCK_USER_ID, 30, undefined);
    expect(mockedGetTotals).toHaveBeenCalledWith(MOCK_USER_ID, 30, undefined);
  });

  it("parses 7d period correctly", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/summary?period=7d");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockedGetDailySpend).toHaveBeenCalledWith(MOCK_USER_ID, 7, undefined);
    const body = await res.json();
    expect(body.totals.period).toBe("7d");
  });

  it("parses 90d period correctly", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/summary?period=90d");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockedGetDailySpend).toHaveBeenCalledWith(MOCK_USER_ID, 90, undefined);
    const body = await res.json();
    expect(body.totals.period).toBe("90d");
  });

  it("returns 400 for invalid period value", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/summary?period=14d");
    const res = await GET(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.message).toBe("Request validation failed.");
  });

  it("returns 401 when session is invalid", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionUserId.mockRejectedValue(new AuthenticationRequiredError());

    const req = new Request("http://localhost/api/cost-events/summary");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it("calls all nine aggregation functions in parallel", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/summary?period=7d");
    await GET(req);

    expect(mockedGetDailySpend).toHaveBeenCalledTimes(1);
    expect(mockedGetModelBreakdown).toHaveBeenCalledTimes(1);
    expect(mockedGetProviderBreakdown).toHaveBeenCalledTimes(1);
    expect(mockedGetKeyBreakdown).toHaveBeenCalledTimes(1);
    expect(mockedGetToolBreakdown).toHaveBeenCalledTimes(1);
    expect(mockedGetSourceBreakdown).toHaveBeenCalledTimes(1);
    expect(mockedGetTraceBreakdown).toHaveBeenCalledTimes(1);
    expect(mockedGetTotals).toHaveBeenCalledTimes(1);
    expect(mockedGetCostBreakdownTotals).toHaveBeenCalledTimes(1);
  });

  it("returns 200 with empty arrays when no data exists", async () => {
    mockedResolveSessionUserId.mockResolvedValue(MOCK_USER_ID);
    mockedGetDailySpend.mockResolvedValue([]);
    mockedGetModelBreakdown.mockResolvedValue([]);
    mockedGetProviderBreakdown.mockResolvedValue([]);
    mockedGetKeyBreakdown.mockResolvedValue([]);
    mockedGetToolBreakdown.mockResolvedValue([]);
    mockedGetSourceBreakdown.mockResolvedValue([]);
    mockedGetTraceBreakdown.mockResolvedValue([]);
    mockedGetTotals.mockResolvedValue({ totalCostMicrodollars: 0, totalRequests: 0 });
    mockedGetCostBreakdownTotals.mockResolvedValue({ inputCost: 0, outputCost: 0, cachedCost: 0, reasoningCost: 0 });

    const req = new Request("http://localhost/api/cost-events/summary");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.daily).toEqual([]);
    expect(body.models).toEqual([]);
    expect(body.providers).toEqual([]);
    expect(body.keys).toEqual([]);
    expect(body.tools).toEqual([]);
    expect(body.sources).toEqual([]);
    expect(body.traces).toEqual([]);
    expect(body.costBreakdown).toEqual({ inputCost: 0, outputCost: 0, cachedCost: 0, reasoningCost: 0 });
    expect(body.totals.totalCostMicrodollars).toBe(0);
    expect(body.totals.totalRequests).toBe(0);
  });

  it("returns 500 when an aggregation function throws", async () => {
    mockedResolveSessionUserId.mockResolvedValue(MOCK_USER_ID);
    mockedGetDailySpend.mockRejectedValue(new Error("DB connection lost"));
    mockedGetModelBreakdown.mockResolvedValue([]);
    mockedGetProviderBreakdown.mockResolvedValue([]);
    mockedGetKeyBreakdown.mockResolvedValue([]);
    mockedGetToolBreakdown.mockResolvedValue([]);
    mockedGetSourceBreakdown.mockResolvedValue([]);
    mockedGetTraceBreakdown.mockResolvedValue([]);
    mockedGetTotals.mockResolvedValue({ totalCostMicrodollars: 0, totalRequests: 0 });
    mockedGetCostBreakdownTotals.mockResolvedValue({ inputCost: 0, outputCost: 0, cachedCost: 0, reasoningCost: 0 });

    vi.spyOn(console, "error").mockImplementation(() => {});

    const req = new Request("http://localhost/api/cost-events/summary");
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).toBe("Internal server error.");
  });

  it("passes the authenticated user ID to all aggregation functions", async () => {
    const customUserId = "custom-user-xyz";
    mockedResolveSessionUserId.mockResolvedValue(customUserId);
    mockedGetDailySpend.mockResolvedValue([]);
    mockedGetModelBreakdown.mockResolvedValue([]);
    mockedGetProviderBreakdown.mockResolvedValue([]);
    mockedGetKeyBreakdown.mockResolvedValue([]);
    mockedGetToolBreakdown.mockResolvedValue([]);
    mockedGetSourceBreakdown.mockResolvedValue([]);
    mockedGetTraceBreakdown.mockResolvedValue([]);
    mockedGetTotals.mockResolvedValue({ totalCostMicrodollars: 0, totalRequests: 0 });
    mockedGetCostBreakdownTotals.mockResolvedValue({ inputCost: 0, outputCost: 0, cachedCost: 0, reasoningCost: 0 });

    const req = new Request("http://localhost/api/cost-events/summary?period=7d");
    await GET(req);

    expect(mockedGetDailySpend).toHaveBeenCalledWith(customUserId, 7, undefined);
    expect(mockedGetModelBreakdown).toHaveBeenCalledWith(customUserId, 7, undefined);
    expect(mockedGetProviderBreakdown).toHaveBeenCalledWith(customUserId, 7, undefined);
    expect(mockedGetKeyBreakdown).toHaveBeenCalledWith(customUserId, 7, undefined);
    expect(mockedGetToolBreakdown).toHaveBeenCalledWith(customUserId, 7, undefined);
    expect(mockedGetSourceBreakdown).toHaveBeenCalledWith(customUserId, 7, undefined);
    expect(mockedGetTraceBreakdown).toHaveBeenCalledWith(customUserId, 7, undefined);
    expect(mockedGetTotals).toHaveBeenCalledWith(customUserId, 7, undefined);
    expect(mockedGetCostBreakdownTotals).toHaveBeenCalledWith(customUserId, 7, undefined);
  });

  it("passes excludeEstimated option when query param is true", async () => {
    setupMocks();

    const req = new Request("http://localhost/api/cost-events/summary?period=30d&excludeEstimated=true");
    await GET(req);

    const expectedOpts = { excludeEstimated: true };
    expect(mockedGetDailySpend).toHaveBeenCalledWith(MOCK_USER_ID, 30, expectedOpts);
    expect(mockedGetModelBreakdown).toHaveBeenCalledWith(MOCK_USER_ID, 30, expectedOpts);
    expect(mockedGetProviderBreakdown).toHaveBeenCalledWith(MOCK_USER_ID, 30, expectedOpts);
    expect(mockedGetKeyBreakdown).toHaveBeenCalledWith(MOCK_USER_ID, 30, expectedOpts);
    expect(mockedGetToolBreakdown).toHaveBeenCalledWith(MOCK_USER_ID, 30, expectedOpts);
    expect(mockedGetSourceBreakdown).toHaveBeenCalledWith(MOCK_USER_ID, 30, expectedOpts);
    expect(mockedGetTraceBreakdown).toHaveBeenCalledWith(MOCK_USER_ID, 30, expectedOpts);
    expect(mockedGetTotals).toHaveBeenCalledWith(MOCK_USER_ID, 30, expectedOpts);
    expect(mockedGetCostBreakdownTotals).toHaveBeenCalledWith(MOCK_USER_ID, 30, expectedOpts);
  });
});
