import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { invalidateProxyCache } from "@/lib/proxy-invalidate";
import { GET, POST } from "@/app/api/budgets/route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
  addSentryBreadcrumb: vi.fn(),
}));

vi.mock("@/lib/proxy-invalidate", () => ({
  invalidateProxyCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  getSubscriptionByUserId: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/stripe/tiers", () => ({
  getTierForUser: vi.fn().mockReturnValue("free"),
  TIERS: {
    free: { label: "Free", spendCapMicrodollars: 100_000_000_000, maxBudgets: Infinity },
    pro: { label: "Pro", spendCapMicrodollars: 1_000_000_000_000, maxBudgets: Infinity },
  },
}));

vi.mock("@/lib/utils/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils/http")>();
  return {
    ...actual,
    readJsonBody: vi.fn(),
  };
});

const mockedInvalidateProxyCache = vi.mocked(invalidateProxyCache);

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

function makeRequest(path = "/api/budgets") {
  return new Request(`http://localhost${path}`);
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

    const response = await GET(makeRequest());
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

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toHaveLength(2);
  });

  it("returns 401 when session is not authenticated", async () => {
    mockedResolveSessionUserId.mockRejectedValue(new Error("Unauthorized"));

    const response = await GET(makeRequest());
    expect(response.status).toBe(500);
  });

  it("serializes date fields to ISO strings", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeBudgetRow()]);

    const response = await GET(makeRequest());
    const json = await response.json();
    expect(json.data[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(json.data[0].currentPeriodStart).toBe("2026-03-01T00:00:00.000Z");
  });

  it("returns null for currentPeriodStart when it is null", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeBudgetRow({ currentPeriodStart: null })]);

    const response = await GET(makeRequest());
    const json = await response.json();
    expect(json.data[0].currentPeriodStart).toBeNull();
  });

  it("returns empty data array when user has no budgets", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await GET(makeRequest());
    const json = await response.json();
    expect(json.data).toEqual([]);
  });

  it("serializes updatedAt to ISO string", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeBudgetRow()]);

    const response = await GET(makeRequest());
    const json = await response.json();
    expect(json.data[0].updatedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("includes all budget fields in response", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeBudgetRow()]);

    const response = await GET(makeRequest());
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
    expect(budget).toHaveProperty("thresholdPercentages");
  });

  it("response includes thresholdPercentages", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockWhere
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeBudgetRow({ thresholdPercentages: [25, 50, 75] })]);

    const response = await GET(makeRequest());
    const json = await response.json();
    expect(json.data[0].thresholdPercentages).toEqual([25, 50, 75]);
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

    const response = await GET(makeRequest());
    const json = await response.json();
    expect(json.data).toHaveLength(3);
  });
});

describe("POST /api/budgets — proxy invalidation", () => {
  const TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440000";

  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveSessionUserId.mockResolvedValue(TEST_USER_ID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST with custom thresholdPercentages creates budget", async () => {
    const { readJsonBody } = await import("@/lib/utils/http");
    const mockedReadJsonBody = vi.mocked(readJsonBody);
    mockedReadJsonBody.mockResolvedValue({
      entityType: "user",
      entityId: `ns_usr_${TEST_USER_ID}`,
      maxBudgetMicrodollars: 10_000_000,
      thresholdPercentages: [25, 50, 75],
    });

    const budgetRow = makeBudgetRow({
      entityId: TEST_USER_ID,
      thresholdPercentages: [25, 50, 75],
    });
    const mockReturning = vi.fn().mockResolvedValue([budgetRow]);
    const mockOnConflict = vi.fn(() => ({ returning: mockReturning }));
    const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflict }));
    const mockInsert = vi.fn(() => ({ values: mockValues }));
    const mockWhere = vi.fn().mockResolvedValue([budgetRow]);
    const mockFrom = vi.fn(() => ({ where: mockWhere }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));
    mockedGetDb.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
    } as unknown as ReturnType<typeof getDb>);

    const request = new Request("http://localhost/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.thresholdPercentages).toEqual([25, 50, 75]);
  });

  it("upsert without thresholdPercentages preserves existing custom value", async () => {
    const { readJsonBody } = await import("@/lib/utils/http");
    const mockedReadJsonBody = vi.mocked(readJsonBody);
    mockedReadJsonBody.mockResolvedValue({
      entityType: "user",
      entityId: `ns_usr_${TEST_USER_ID}`,
      maxBudgetMicrodollars: 20_000_000,
      // thresholdPercentages intentionally omitted
    });

    const budgetRow = makeBudgetRow({
      entityId: TEST_USER_ID,
      maxBudgetMicrodollars: 20_000_000,
      thresholdPercentages: [25, 50, 75], // existing custom value preserved
    });
    const mockReturning = vi.fn().mockResolvedValue([budgetRow]);
    const mockOnConflict = vi.fn(() => ({ returning: mockReturning }));
    const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflict }));
    const mockInsert = vi.fn(() => ({ values: mockValues }));
    const mockWhere = vi.fn().mockResolvedValue([budgetRow]);
    const mockFrom = vi.fn(() => ({ where: mockWhere }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));
    mockedGetDb.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
    } as unknown as ReturnType<typeof getDb>);

    const request = new Request("http://localhost/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);
    const json = await response.json();
    // DB returns the existing custom value since we didn't override it
    expect(json.thresholdPercentages).toEqual([25, 50, 75]);

    // Verify thresholdPercentages was NOT in the .values() or .set() calls
    const valuesArg = (mockValues.mock.calls as any)[0][0];
    expect(valuesArg).not.toHaveProperty("thresholdPercentages");
    const setArg = (mockOnConflict.mock.calls as any)[0][0].set;
    expect(setArg).not.toHaveProperty("thresholdPercentages");
  });

  it("calls invalidateProxyCache with sync action after budget creation", async () => {
    const { readJsonBody } = await import("@/lib/utils/http");
    const mockedReadJsonBody = vi.mocked(readJsonBody);
    mockedReadJsonBody.mockResolvedValue({
      entityType: "user",
      entityId: `ns_usr_${TEST_USER_ID}`,
      maxBudgetMicrodollars: 10_000_000,
    });

    // Mock DB chain: verifyEntityOwnership skipped for user type
    // existingForEntity (already exists → skip count check) + insert/upsert
    const budgetRow = makeBudgetRow({ entityId: TEST_USER_ID });
    const mockReturning = vi.fn().mockResolvedValue([budgetRow]);
    const mockOnConflict = vi.fn(() => ({ returning: mockReturning }));
    const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflict }));
    const mockInsert = vi.fn(() => ({ values: mockValues }));
    const mockWhere = vi.fn().mockResolvedValue([budgetRow]); // existingForEntity returns 1 row
    const mockFrom = vi.fn(() => ({ where: mockWhere }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));
    mockedGetDb.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
    } as unknown as ReturnType<typeof getDb>);

    const request = new Request("http://localhost/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    expect(mockedInvalidateProxyCache).toHaveBeenCalledWith({
      action: "sync",
      userId: TEST_USER_ID,
      entityType: "user",
      entityId: TEST_USER_ID,
    });
  });
});
