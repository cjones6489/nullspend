import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { getSourceBreakdownForEntity } from "@/lib/cost-events/aggregate-cost-events";
import { GET } from "./route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

let mockDbRows: Array<{ entityType: string; entityId: string }> = [];

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => mockDbRows),
      })),
    })),
  })),
}));

vi.mock("@/lib/cost-events/aggregate-cost-events", () => ({
  getSourceBreakdownForEntity: vi.fn(),
}));

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);
const mockedGetSourceBreakdownForEntity = vi.mocked(getSourceBreakdownForEntity);

afterEach(() => {
  vi.resetAllMocks();
  mockedResolveSessionContext.mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" });
  mockDbRows = [{ entityType: "api_key", entityId: "key-abc-123" }];
});

// Reset to default for each test
beforeEach(() => {
  mockDbRows = [{ entityType: "api_key", entityId: "key-abc-123" }];
});

import { beforeEach } from "vitest";

function makeRequest(id: string, period?: string) {
  const url = `http://localhost/api/budgets/${id}/sources${period ? `?period=${period}` : ""}`;
  return new Request(url);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const BUDGET_ID = "ns_bgt_550e8400-e29b-41d4-a716-446655440000";

describe("GET /api/budgets/[id]/sources", () => {
  it("returns source breakdown for a budget", async () => {
    mockedGetSourceBreakdownForEntity.mockResolvedValue([
      { source: "proxy", totalCostMicrodollars: 5_000_000, requestCount: 30 },
      { source: "api", totalCostMicrodollars: 2_000_000, requestCount: 10 },
    ]);

    const res = await GET(makeRequest(BUDGET_ID), makeParams(BUDGET_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toEqual({
      source: "proxy",
      totalCostMicrodollars: 5_000_000,
      requestCount: 30,
    });
  });

  it("returns empty array when no events match", async () => {
    mockedGetSourceBreakdownForEntity.mockResolvedValue([]);

    const res = await GET(makeRequest(BUDGET_ID), makeParams(BUDGET_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it("passes correct period to aggregation function", async () => {
    mockedGetSourceBreakdownForEntity.mockResolvedValue([]);

    await GET(makeRequest(BUDGET_ID, "7d"), makeParams(BUDGET_ID));

    expect(mockedGetSourceBreakdownForEntity).toHaveBeenCalledWith(
      "org-test-1",
      "api_key",
      "key-abc-123",
      7,
    );
  });

  it("defaults to 30d period", async () => {
    mockedGetSourceBreakdownForEntity.mockResolvedValue([]);

    await GET(makeRequest(BUDGET_ID), makeParams(BUDGET_ID));

    expect(mockedGetSourceBreakdownForEntity).toHaveBeenCalledWith(
      "org-test-1",
      "api_key",
      "key-abc-123",
      30,
    );
  });

  it("returns 401 when not authenticated", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionContext.mockRejectedValue(new AuthenticationRequiredError());

    const res = await GET(makeRequest(BUDGET_ID), makeParams(BUDGET_ID));

    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid period", async () => {
    const res = await GET(makeRequest(BUDGET_ID, "14d"), makeParams(BUDGET_ID));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("returns all three source types", async () => {
    mockedGetSourceBreakdownForEntity.mockResolvedValue([
      { source: "proxy", totalCostMicrodollars: 5_000_000, requestCount: 30 },
      { source: "api", totalCostMicrodollars: 2_000_000, requestCount: 10 },
      { source: "mcp", totalCostMicrodollars: 1_000_000, requestCount: 5 },
    ]);

    const res = await GET(makeRequest(BUDGET_ID), makeParams(BUDGET_ID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(3);
    expect(body.data.map((s: { source: string }) => s.source)).toEqual(["proxy", "api", "mcp"]);
  });

  it("returns 404 when budget does not exist", async () => {
    mockDbRows = [];

    const res = await GET(makeRequest(BUDGET_ID), makeParams(BUDGET_ID));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(mockedGetSourceBreakdownForEntity).not.toHaveBeenCalled();
  });

  it("passes tag entity correctly to aggregation function", async () => {
    mockDbRows = [{ entityType: "tag", entityId: "env=prod" }];
    mockedGetSourceBreakdownForEntity.mockResolvedValue([]);

    await GET(makeRequest(BUDGET_ID), makeParams(BUDGET_ID));

    expect(mockedGetSourceBreakdownForEntity).toHaveBeenCalledWith(
      "org-test-1",
      "tag",
      "env=prod",
      30,
    );
  });

  it("passes tag entity with equals in value correctly", async () => {
    mockDbRows = [{ entityType: "tag", entityId: "query=x=1" }];
    mockedGetSourceBreakdownForEntity.mockResolvedValue([]);

    await GET(makeRequest(BUDGET_ID), makeParams(BUDGET_ID));

    expect(mockedGetSourceBreakdownForEntity).toHaveBeenCalledWith(
      "org-test-1",
      "tag",
      "query=x=1",
      30,
    );
  });

  it("passes user entity correctly to aggregation function", async () => {
    mockDbRows = [{ entityType: "user", entityId: "user-xyz-789" }];
    mockedGetSourceBreakdownForEntity.mockResolvedValue([]);

    await GET(makeRequest(BUDGET_ID), makeParams(BUDGET_ID));

    expect(mockedGetSourceBreakdownForEntity).toHaveBeenCalledWith(
      "org-test-1",
      "user",
      "user-xyz-789",
      30,
    );
  });
});
