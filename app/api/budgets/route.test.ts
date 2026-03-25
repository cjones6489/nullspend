import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { invalidateProxyCache } from "@/lib/proxy-invalidate";
import { GET, POST } from "@/app/api/budgets/route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
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

const mockedResolveSessionContext = vi.mocked(resolveSessionContext);
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
    sessionLimitMicrodollars: null,
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
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-123", role: "owner" });

    const userBudget = makeBudgetRow();
    mockWhere.mockResolvedValueOnce([userBudget]);

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].entityType).toBe("user");
  });

  it("returns 200 with both user and api_key budgets when keys exist", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-123", role: "owner" });

    const keyBudget = makeBudgetRow({
      id: "b0000000-0000-4000-a000-000000000002",
      entityType: "api_key",
      entityId: "key-123",
    });

    mockWhere.mockResolvedValueOnce([makeBudgetRow(), keyBudget]);

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toHaveLength(2);
  });

  it("returns 401 when session is not authenticated", async () => {
    const { AuthenticationRequiredError } = await import("@/lib/auth/errors");
    mockedResolveSessionContext.mockRejectedValue(new AuthenticationRequiredError());

    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
  });

  it("serializes date fields to ISO strings", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-123", role: "owner" });
    mockWhere.mockResolvedValueOnce([makeBudgetRow()]);

    const response = await GET(makeRequest());
    const json = await response.json();
    expect(json.data[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(json.data[0].currentPeriodStart).toBe("2026-03-01T00:00:00.000Z");
  });

  it("returns null for currentPeriodStart when it is null", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-123", role: "owner" });
    mockWhere.mockResolvedValueOnce([makeBudgetRow({ currentPeriodStart: null })]);

    const response = await GET(makeRequest());
    const json = await response.json();
    expect(json.data[0].currentPeriodStart).toBeNull();
  });

  it("returns empty data array when user has no budgets", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-123", role: "owner" });
    mockWhere.mockResolvedValueOnce([]);

    const response = await GET(makeRequest());
    const json = await response.json();
    expect(json.data).toEqual([]);
  });

  it("serializes updatedAt to ISO string", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-123", role: "owner" });
    mockWhere.mockResolvedValueOnce([makeBudgetRow()]);

    const response = await GET(makeRequest());
    const json = await response.json();
    expect(json.data[0].updatedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("includes all budget fields in response", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-123", role: "owner" });
    mockWhere.mockResolvedValueOnce([makeBudgetRow()]);

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
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-123", role: "owner" });
    mockWhere.mockResolvedValueOnce([makeBudgetRow({ thresholdPercentages: [25, 50, 75] })]);

    const response = await GET(makeRequest());
    const json = await response.json();
    expect(json.data[0].thresholdPercentages).toEqual([25, 50, 75]);
  });

  it("handles multiple api keys correctly", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-123", role: "owner" });
    const budgetRows = [
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
    mockWhere.mockResolvedValueOnce(budgetRows);

    const response = await GET(makeRequest());
    const json = await response.json();
    expect(json.data).toHaveLength(3);
  });
});

describe("POST /api/budgets — proxy invalidation", () => {
  const TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440000";

  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveSessionContext.mockResolvedValue({ userId: TEST_USER_ID, orgId: "org-test-1", role: "owner" });
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
    const mockTxDb = { select: mockSelect, insert: mockInsert };
    mockedGetDb.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockTxDb)),
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
    const mockTxDb = { select: mockSelect, insert: mockInsert };
    mockedGetDb.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockTxDb)),
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
    const mockTxDb = { select: mockSelect, insert: mockInsert };
    mockedGetDb.mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockTxDb)),
    } as unknown as ReturnType<typeof getDb>);

    const request = new Request("http://localhost/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    expect(mockedInvalidateProxyCache).toHaveBeenCalledWith({
      action: "sync",
      ownerId: "org-test-1",
      entityType: "user",
      entityId: TEST_USER_ID,
    });
  });

  it("returns 409 limit_exceeded when budget count exceeds tier limit", async () => {
    // Override TIERS mock for this test — free tier with maxBudgets: 1
    const { TIERS } = await import("@/lib/stripe/tiers");
    const mockedTIERS = vi.mocked(TIERS);
    (mockedTIERS as Record<string, Record<string, unknown>>).free.maxBudgets = 1;

    const { readJsonBody } = await import("@/lib/utils/http");
    const mockedReadJsonBody = vi.mocked(readJsonBody);
    mockedReadJsonBody.mockResolvedValue({
      entityType: "user",
      entityId: `ns_usr_${TEST_USER_ID}`,
      maxBudgetMicrodollars: 5_000_000,
    });

    // Mock: existingForEntity returns [] (new entity), count returns 1 (at limit)
    const mockWhere = vi.fn()
      .mockResolvedValueOnce([])          // existingForEntity check
      .mockResolvedValueOnce([{ count: 1 }]);  // budget count query
    const mockFrom = vi.fn(() => ({ where: mockWhere }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));
    const mockTxDb = { select: mockSelect, insert: vi.fn() };
    mockedGetDb.mockReturnValue({
      transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockTxDb)),
    } as unknown as ReturnType<typeof getDb>);

    const request = new Request("http://localhost/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error.code).toBe("limit_exceeded");
    expect(json.error.message).toContain("Free");

    // Restore
    (mockedTIERS as Record<string, Record<string, unknown>>).free.maxBudgets = Infinity;
  });

  it("returns 400 spend_cap_exceeded when budget exceeds tier spend cap", async () => {
    const { readJsonBody } = await import("@/lib/utils/http");
    const mockedReadJsonBody = vi.mocked(readJsonBody);
    mockedReadJsonBody.mockResolvedValue({
      entityType: "user",
      entityId: `ns_usr_${TEST_USER_ID}`,
      maxBudgetMicrodollars: 999_000_000_000, // exceeds the $100K mock cap
    });

    mockedGetDb.mockReturnValue({} as unknown as ReturnType<typeof getDb>);

    const request = new Request("http://localhost/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("spend_cap_exceeded");
  });
});
