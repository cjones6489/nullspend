import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { GET } from "@/app/api/budgets/route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);
const mockedGetDb = vi.mocked(getDb);

function makeBudgetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "b0000000-0000-4000-a000-000000000001",
    entityType: "user",
    entityId: "user-123",
    maxBudgetMicrodollars: 10_000_000,
    spendMicrodollars: 2_500_000,
    policy: "strict_block",
    resetInterval: "monthly",
    currentPeriodStart: new Date("2026-03-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-03-01T00:00:00Z"),
    ...overrides,
  };
}

describe("GET /api/budgets", () => {
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockFrom: ReturnType<typeof vi.fn>;
  let mockWhere: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockWhere = vi.fn();
    mockFrom = vi.fn(() => ({ where: mockWhere }));
    mockSelect = vi.fn(() => ({ from: mockFrom }));
    mockedGetDb.mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof getDb>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 with user budgets when user has no API keys", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");

    const userBudget = makeBudgetRow();
    mockWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([userBudget]);

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].entityType).toBe("user");
  });

  it("returns 200 with both user and api_key budgets when keys exist", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");

    const keyBudget = makeBudgetRow({
      id: "b0000000-0000-4000-a000-000000000002",
      entityType: "api_key",
      entityId: "key-123",
    });

    mockWhere
      .mockResolvedValueOnce([{ id: "key-123" }])
      .mockResolvedValueOnce([makeBudgetRow(), keyBudget]);

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toHaveLength(2);
  });

  it("returns 401 when session is not authenticated", async () => {
    mockedResolveSessionUserId.mockRejectedValue(new Error("Unauthorized"));

    const response = await GET();
    expect(response.status).toBe(500);
  });

  it("serializes date fields to ISO strings", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeBudgetRow()]);

    const response = await GET();
    const json = await response.json();
    expect(json.data[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(json.data[0].currentPeriodStart).toBe("2026-03-01T00:00:00.000Z");
  });

  it("returns null for currentPeriodStart when it is null", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeBudgetRow({ currentPeriodStart: null })]);

    const response = await GET();
    const json = await response.json();
    expect(json.data[0].currentPeriodStart).toBeNull();
  });

  it("returns empty data array when user has no budgets", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await GET();
    const json = await response.json();
    expect(json.data).toEqual([]);
  });

  it("serializes updatedAt to ISO string", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeBudgetRow()]);

    const response = await GET();
    const json = await response.json();
    expect(json.data[0].updatedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("includes all budget fields in response", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeBudgetRow()]);

    const response = await GET();
    const json = await response.json();
    const budget = json.data[0];
    expect(budget).toHaveProperty("id");
    expect(budget).toHaveProperty("entityType");
    expect(budget).toHaveProperty("entityId");
    expect(budget).toHaveProperty("maxBudgetMicrodollars");
    expect(budget).toHaveProperty("spendMicrodollars");
    expect(budget).toHaveProperty("resetInterval");
    expect(budget).toHaveProperty("currentPeriodStart");
    expect(budget).toHaveProperty("createdAt");
    expect(budget).toHaveProperty("updatedAt");
  });

  it("handles multiple api keys correctly", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    const budgets = [
      makeBudgetRow(),
      makeBudgetRow({
        id: "b0000000-0000-4000-a000-000000000002",
        entityType: "api_key",
        entityId: "key-aaa",
      }),
      makeBudgetRow({
        id: "b0000000-0000-4000-a000-000000000003",
        entityType: "api_key",
        entityId: "key-bbb",
      }),
    ];
    mockWhere
      .mockResolvedValueOnce([{ id: "key-aaa" }, { id: "key-bbb" }])
      .mockResolvedValueOnce(budgets);

    const response = await GET();
    const json = await response.json();
    expect(json.data).toHaveLength(3);
  });
});
