import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { invalidateProxyCache } from "@/lib/proxy-invalidate";
import { LimitExceededError, SpendCapExceededError } from "@/lib/utils/http";
import { eq } from "drizzle-orm";
import { GET, POST } from "@/app/api/budgets/route";

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/auth/with-api-key-auth", () => ({
  authenticateApiKey: vi.fn(),
  applyRateLimitHeaders: vi.fn((res) => res),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
  assertOrgMember: vi.fn().mockResolvedValue({ userId: "user-1", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

// Spy on drizzle's eq() so we can inspect what column/value combinations the
// route actually uses to scope its queries — needed to verify that API-key
// auth results in a query scoped to the API-key's orgId (not a leaked session one).
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn((col, val) => ({ _mockEq: true, col, val })),
  };
});

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
  addSentryBreadcrumb: vi.fn(),
}));

vi.mock("@/lib/proxy-invalidate", () => ({
  invalidateProxyCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/stripe/subscription", () => ({
  getSubscriptionByOrgId: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/stripe/tiers", () => ({
  getTierForUser: vi.fn().mockReturnValue("free"),
  TIERS: {
    free: { label: "Free", spendCapMicrodollars: 100_000_000_000, maxBudgets: Infinity },
    pro: { label: "Pro", spendCapMicrodollars: 1_000_000_000_000, maxBudgets: Infinity },
  },
}));

/* ---- Feature gate ---- */
const mockResolveOrgTier = vi.fn().mockResolvedValue({ tier: "free", label: "Free" });
const mockAssertCountBelowLimit = vi.fn();
const mockAssertAmountBelowCap = vi.fn();

vi.mock("@/lib/stripe/feature-gate", () => ({
  resolveOrgTier: (...args: unknown[]) => mockResolveOrgTier(...args),
  assertCountBelowLimit: (...args: unknown[]) => mockAssertCountBelowLimit(...args),
  assertAmountBelowCap: (...args: unknown[]) => mockAssertAmountBelowCap(...args),
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

  it("returns tag budget with entityId unchanged (no UUID prefix)", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-123", role: "owner" });
    const budgetRows = [
      makeBudgetRow({
        id: "b0000000-0000-4000-a000-000000000004",
        entityType: "tag",
        entityId: "customer=acme",
      }),
    ];
    mockWhere.mockResolvedValueOnce(budgetRows);

    const response = await GET(makeRequest());
    const json = await response.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].entityType).toBe("tag");
    // Tag entityId should pass through as-is, not get UUID prefix wrapping
    expect(json.data[0].entityId).toBe("customer=acme");
  });

  // ──────────────────────────────────────────────────────────────────────
  // API key auth path (SDK callers)
  // ──────────────────────────────────────────────────────────────────────

  it("authorizes via API key header (SDK path) and scopes query to API-key org", async () => {
    const { authenticateApiKey } = await import("@/lib/auth/with-api-key-auth");
    const mockAuth = vi.mocked(authenticateApiKey);
    mockAuth.mockResolvedValue({
      userId: "user-from-key",
      orgId: "org-from-api-key",
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });
    // Snapshot session-helper call count BEFORE this test so we can detect a fresh call
    const sessionCallsBefore = mockedResolveSessionContext.mock.calls.length;
    mockWhere.mockResolvedValueOnce([makeBudgetRow()]);

    const req = new Request("http://localhost/api/budgets", {
      headers: { "x-nullspend-key": "ns_live_sk_test" },
    });
    const response = await GET(req);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toHaveLength(1);
    // Session helper should NOT be called when API key is present
    expect(mockedResolveSessionContext.mock.calls.length).toBe(sessionCallsBefore);
    // API key auth should have been invoked
    expect(mockAuth).toHaveBeenCalled();
    // And the DB query must be scoped by the API-key's orgId, not a leaked session orgId.
    // eq() is mocked to capture col/val pairs so we can assert directly.
    const mockedEq = vi.mocked(eq);
    const orgIdCalls = mockedEq.mock.calls.filter((call) => call[1] === "org-from-api-key");
    expect(orgIdCalls.length).toBeGreaterThan(0);
    // And no query should have used the stale session orgId
    const wrongCalls = mockedEq.mock.calls.filter((call) => call[1] === "org-test-1");
    expect(wrongCalls.length).toBe(0);
  });

  it("returns 403 when API key has no orgId", async () => {
    const { authenticateApiKey } = await import("@/lib/auth/with-api-key-auth");
    vi.mocked(authenticateApiKey).mockResolvedValue({
      userId: "user-from-key",
      orgId: null,
      keyId: "key-1",
      apiVersion: "2026-04-01",
    });

    const req = new Request("http://localhost/api/budgets", {
      headers: { "x-nullspend-key": "ns_live_sk_test" },
    });
    const response = await GET(req);

    expect(response.status).toBe(403);
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
    expect(json.data.thresholdPercentages).toEqual([25, 50, 75]);
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
    expect(json.data.thresholdPercentages).toEqual([25, 50, 75]);

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
    const { readJsonBody } = await import("@/lib/utils/http");
    vi.mocked(readJsonBody).mockResolvedValue({
      entityType: "user",
      entityId: `ns_usr_${TEST_USER_ID}`,
      maxBudgetMicrodollars: 5_000_000,
    });

    // assertCountBelowLimit throws LimitExceededError
    mockAssertCountBelowLimit.mockImplementationOnce(() => {
      throw new LimitExceededError("Maximum of 5 budgets allowed on the Free plan. Upgrade for more.");
    });

    // Mock: existingForEntity returns [] (new entity) so count check fires
    const mockWhere = vi.fn()
      .mockResolvedValueOnce([])           // existingForEntity check
      .mockResolvedValueOnce([{ count: 5 }]);  // budget count query
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
    expect(json.error.message).toContain("Maximum of 5 budgets");
  });

  it("returns 400 spend_cap_exceeded when budget amount exceeds tier cap", async () => {
    const { readJsonBody } = await import("@/lib/utils/http");
    vi.mocked(readJsonBody).mockResolvedValue({
      entityType: "user",
      entityId: `ns_usr_${TEST_USER_ID}`,
      maxBudgetMicrodollars: 999_000_000_000,
    });

    // assertAmountBelowCap throws SpendCapExceededError
    mockAssertAmountBelowCap.mockImplementationOnce(() => {
      throw new SpendCapExceededError("Budget amount exceeds your Free tier spend cap of $100,000. Upgrade your plan to increase your limit.");
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

  it("POST with tag entityType creates budget (ownership passthrough)", async () => {
    const { readJsonBody } = await import("@/lib/utils/http");
    const mockedReadJsonBody = vi.mocked(readJsonBody);
    mockedReadJsonBody.mockResolvedValue({
      entityType: "tag",
      entityId: "customer=acme",
      maxBudgetMicrodollars: 10_000_000,
    });

    const budgetRow = makeBudgetRow({
      entityType: "tag",
      entityId: "customer=acme",
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
    expect(json.data.entityType).toBe("tag");
    expect(json.data.entityId).toBe("customer=acme");

    // Verify proxy cache invalidation fires with tag entity
    expect(mockedInvalidateProxyCache).toHaveBeenCalledWith({
      action: "sync",
      ownerId: "org-test-1",
      entityType: "tag",
      entityId: "customer=acme",
    });
  });

  it("POST with policy: warn stores and returns the policy", async () => {
    const { readJsonBody } = await import("@/lib/utils/http");
    const mockedReadJsonBody = vi.mocked(readJsonBody);
    mockedReadJsonBody.mockResolvedValue({
      entityType: "user",
      entityId: `ns_usr_${TEST_USER_ID}`,
      maxBudgetMicrodollars: 10_000_000,
      policy: "warn",
    });

    const budgetRow = makeBudgetRow({ entityId: TEST_USER_ID, policy: "warn" });
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
    expect(json.data.policy).toBe("warn");

    // Verify policy was passed to .values()
    const valuesArg = (mockValues.mock.calls as any)[0][0];
    expect(valuesArg.policy).toBe("warn");
    // Verify policy was passed to .onConflictDoUpdate set
    const setArg = (mockOnConflict.mock.calls as any)[0][0].set;
    expect(setArg.policy).toBe("warn");
  });

  it("POST with policy: soft_block stores and returns the policy", async () => {
    const { readJsonBody } = await import("@/lib/utils/http");
    const mockedReadJsonBody = vi.mocked(readJsonBody);
    mockedReadJsonBody.mockResolvedValue({
      entityType: "user",
      entityId: `ns_usr_${TEST_USER_ID}`,
      maxBudgetMicrodollars: 10_000_000,
      policy: "soft_block",
    });

    const budgetRow = makeBudgetRow({ entityId: TEST_USER_ID, policy: "soft_block" });
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
    expect(json.data.policy).toBe("soft_block");
  });

  it("POST without policy omits it from values/set (preserves DB default)", async () => {
    const { readJsonBody } = await import("@/lib/utils/http");
    const mockedReadJsonBody = vi.mocked(readJsonBody);
    mockedReadJsonBody.mockResolvedValue({
      entityType: "user",
      entityId: `ns_usr_${TEST_USER_ID}`,
      maxBudgetMicrodollars: 10_000_000,
      // policy intentionally omitted
    });

    const budgetRow = makeBudgetRow({ entityId: TEST_USER_ID, policy: "strict_block" });
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

    // Verify policy was NOT in .values() or .set() — DB default applies
    const valuesArg = (mockValues.mock.calls as any)[0][0];
    expect(valuesArg).not.toHaveProperty("policy");
    const setArg = (mockOnConflict.mock.calls as any)[0][0].set;
    expect(setArg).not.toHaveProperty("policy");
  });

  it("POST with invalid policy returns 400", async () => {
    const { readJsonBody } = await import("@/lib/utils/http");
    vi.mocked(readJsonBody).mockResolvedValue({
      entityType: "user",
      entityId: `ns_usr_${TEST_USER_ID}`,
      maxBudgetMicrodollars: 10_000_000,
      policy: "block_all",
    });

    mockedGetDb.mockReturnValue({} as unknown as ReturnType<typeof getDb>);

    const request = new Request("http://localhost/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("validation_error");
  });

  it("GET returns policy field for all three values", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-123", role: "owner" });

    const budgetRows = [
      makeBudgetRow({ id: "b0000000-0000-4000-a000-000000000010", policy: "strict_block" }),
      makeBudgetRow({ id: "b0000000-0000-4000-a000-000000000011", policy: "soft_block", entityType: "api_key", entityId: "key-1" }),
      makeBudgetRow({ id: "b0000000-0000-4000-a000-000000000012", policy: "warn", entityType: "tag", entityId: "env=prod" }),
    ];
    const mockWhere = vi.fn().mockResolvedValueOnce(budgetRows);
    const mockFrom = vi.fn(() => ({ where: mockWhere }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));
    mockedGetDb.mockReturnValue({ select: mockSelect } as unknown as ReturnType<typeof getDb>);

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toHaveLength(3);
    expect(json.data[0].policy).toBe("strict_block");
    expect(json.data[1].policy).toBe("soft_block");
    expect(json.data[2].policy).toBe("warn");
  });

  it("POST with invalid tag entityId returns 400", async () => {
    const { readJsonBody } = await import("@/lib/utils/http");
    vi.mocked(readJsonBody).mockResolvedValue({
      entityType: "tag",
      entityId: "no-equals-sign",
      maxBudgetMicrodollars: 10_000_000,
    });

    mockedGetDb.mockReturnValue({} as unknown as ReturnType<typeof getDb>);

    const request = new Request("http://localhost/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("POST with resetInterval: yearly creates budget successfully", async () => {
    const { readJsonBody } = await import("@/lib/utils/http");
    const mockedReadJsonBody = vi.mocked(readJsonBody);
    mockedReadJsonBody.mockResolvedValue({
      entityType: "user",
      entityId: `ns_usr_${TEST_USER_ID}`,
      maxBudgetMicrodollars: 50_000_000,
      resetInterval: "yearly",
    });

    const budgetRow = makeBudgetRow({
      entityId: TEST_USER_ID,
      maxBudgetMicrodollars: 50_000_000,
      resetInterval: "yearly",
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
    expect(json.data.resetInterval).toBe("yearly");
    expect(json.data.maxBudgetMicrodollars).toBe(50_000_000);

    // Verify resetInterval was passed through to DB insert
    const valuesArg = (mockValues.mock.calls as any)[0][0];
    expect(valuesArg.resetInterval).toBe("yearly");
  });
});
