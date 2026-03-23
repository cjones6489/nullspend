import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetDb } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
}));

vi.mock("../lib/db.js", () => ({
  getDb: () => mockGetDb(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ eq: val })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  inArray: vi.fn((_col: unknown, vals: unknown) => ({ inArray: vals })),
  getTableColumns: vi.fn(() => ({})),
}));

vi.mock("@nullspend/db", () => ({
  budgets: {
    entityType: "entityType",
    entityId: "entityId",
    userId: "userId",
    maxBudgetMicrodollars: "maxBudgetMicrodollars",
    spendMicrodollars: "spendMicrodollars",
    policy: "policy",
    resetInterval: "resetInterval",
    currentPeriodStart: "currentPeriodStart",
  },
}));

import { lookupBudgetsForDO } from "../lib/budget-do-lookup.js";

function makeMockDb(whereResults: unknown[] | ((...args: unknown[]) => Promise<unknown[]>)) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: typeof whereResults === "function"
      ? vi.fn().mockImplementation(whereResults)
      : vi.fn().mockResolvedValue(whereResults),
  };
}

describe("lookupBudgetsForDO", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns entities with all DO-required fields", async () => {
    const periodDate = new Date("2025-03-01T00:00:00Z");
    const mockDb = makeMockDb([{
      maxBudgetMicrodollars: 50_000_000,
      spendMicrodollars: 10_000_000,
      policy: "strict_block",
      resetInterval: "monthly",
      currentPeriodStart: periodDate,
    }]);
    mockGetDb.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null, userId: "user-1", tags: {},
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      entityType: "user",
      entityId: "user-1",
      maxBudget: 50_000_000,
      spend: 10_000_000,
      policy: "strict_block",
      resetInterval: "monthly",
      periodStart: periodDate.getTime(),
      velocityLimit: null,
      velocityWindow: 60_000,
      velocityCooldown: 60_000,
      thresholdPercentages: [50, 80, 90, 95],
      sessionLimit: null,
    });
  });

  it("converts velocity fields from seconds to ms", async () => {
    const mockDb = makeMockDb([{
      maxBudgetMicrodollars: 50_000_000,
      spendMicrodollars: 10_000_000,
      policy: "strict_block",
      resetInterval: "monthly",
      currentPeriodStart: new Date("2025-03-01T00:00:00Z"),
      velocityLimitMicrodollars: 5_000_000,
      velocityWindowSeconds: 120,
      velocityCooldownSeconds: 90,
    }]);
    mockGetDb.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null, userId: "user-1", tags: {},
    });

    expect(result[0].velocityLimit).toBe(5_000_000);
    expect(result[0].velocityWindow).toBe(120_000);
    expect(result[0].velocityCooldown).toBe(90_000);
  });

  it("defaults velocity window and cooldown to 60s when null", async () => {
    const mockDb = makeMockDb([{
      maxBudgetMicrodollars: 50_000_000,
      spendMicrodollars: 0,
      policy: "strict_block",
      resetInterval: null,
      currentPeriodStart: null,
      velocityLimitMicrodollars: null,
      velocityWindowSeconds: null,
      velocityCooldownSeconds: null,
    }]);
    mockGetDb.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null, userId: "user-1", tags: {},
    });

    expect(result[0].velocityLimit).toBeNull();
    expect(result[0].velocityWindow).toBe(60_000);
    expect(result[0].velocityCooldown).toBe(60_000);
  });

  it("converts timestamp to epoch ms", async () => {
    const date = new Date("2025-06-15T12:00:00Z");
    const mockDb = makeMockDb([{
      maxBudgetMicrodollars: 100_000, spendMicrodollars: 0,
      policy: "warn", resetInterval: "daily", currentPeriodStart: date,
    }]);
    mockGetDb.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: "key-1", userId: null, tags: {},
    });

    expect(result[0].periodStart).toBe(date.getTime());
  });

  it("handles null currentPeriodStart (→ 0)", async () => {
    const mockDb = makeMockDb([{
      maxBudgetMicrodollars: 100_000, spendMicrodollars: 0,
      policy: "strict_block", resetInterval: null, currentPeriodStart: null,
    }]);
    mockGetDb.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null, userId: "user-1", tags: {},
    });

    expect(result[0].periodStart).toBe(0);
  });

  it("handles null resetInterval (→ null)", async () => {
    const mockDb = makeMockDb([{
      maxBudgetMicrodollars: 100_000, spendMicrodollars: 0,
      policy: "strict_block", resetInterval: null,
      currentPeriodStart: new Date("2025-01-01"),
    }]);
    mockGetDb.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null, userId: "user-1", tags: {},
    });

    expect(result[0].resetInterval).toBeNull();
  });

  it("returns empty array when no budgets found", async () => {
    const mockDb = makeMockDb([]);
    mockGetDb.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null, userId: "user-1", tags: {},
    });

    expect(result).toEqual([]);
  });

  it("throws on Postgres error (fail-closed)", async () => {
    mockGetDb.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockRejectedValue(new Error("connection refused")),
    });

    await expect(
      lookupBudgetsForDO("postgres://test", { keyId: null, userId: "user-1", tags: {} }),
    ).rejects.toThrow("connection refused");
  });

  it("skips entities where identity field is null", async () => {
    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null, userId: null, tags: {},
    });

    expect(result).toEqual([]);
    expect(mockGetDb).not.toHaveBeenCalled();
  });

  // ── Tag budget lookup ─────────────────────────────────────────────

  it("returns tag budget entities when tags match", async () => {
    const periodDate = new Date("2025-06-01T00:00:00Z");
    let callCount = 0;
    const mockDb = makeMockDb(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve([{
          maxBudgetMicrodollars: 100_000_000, spendMicrodollars: 20_000_000,
          policy: "strict_block", resetInterval: "monthly", currentPeriodStart: periodDate,
        }]);
      }
      return Promise.resolve([{
        entityId: "project=openclaw",
        maxBudgetMicrodollars: 50_000_000, spendMicrodollars: 5_000_000,
        policy: "strict_block", resetInterval: null, currentPeriodStart: null,
      }]);
    });
    mockGetDb.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null, userId: "user-1", tags: { project: "openclaw" },
    });

    expect(result).toHaveLength(2);
    expect(result[0].entityType).toBe("user");
    expect(result[1]).toEqual({
      entityType: "tag", entityId: "project=openclaw",
      maxBudget: 50_000_000, spend: 5_000_000,
      policy: "strict_block", resetInterval: null, periodStart: 0,
      velocityLimit: null, velocityWindow: 60_000, velocityCooldown: 60_000,
      thresholdPercentages: [50, 80, 90, 95], sessionLimit: null,
    });
  });

  it("does not query tag budgets when tags is empty", async () => {
    const mockDb = makeMockDb([{
      maxBudgetMicrodollars: 100_000, spendMicrodollars: 0,
      policy: "strict_block", resetInterval: null, currentPeriodStart: null,
    }]);
    mockGetDb.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null, userId: "user-1", tags: {},
    });

    expect(result).toHaveLength(1);
    expect(mockDb.where).toHaveBeenCalledTimes(1);
  });

  it("does not query tag budgets when userId is null", async () => {
    const mockDb = makeMockDb([{
      maxBudgetMicrodollars: 100_000, spendMicrodollars: 0,
      policy: "strict_block", resetInterval: null, currentPeriodStart: null,
    }]);
    mockGetDb.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: "key-1", userId: null, tags: { project: "openclaw" },
    });

    expect(result).toHaveLength(1);
    expect(mockDb.where).toHaveBeenCalledTimes(1);
  });

  it("combines user + api_key + tag budgets in one result", async () => {
    let callCount = 0;
    const mockDb = makeMockDb(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve([{
          maxBudgetMicrodollars: 30_000_000, spendMicrodollars: 5_000_000,
          policy: "strict_block", resetInterval: null, currentPeriodStart: null,
        }]);
      }
      if (callCount === 2) {
        return Promise.resolve([{
          maxBudgetMicrodollars: 100_000_000, spendMicrodollars: 20_000_000,
          policy: "strict_block", resetInterval: null, currentPeriodStart: null,
        }]);
      }
      return Promise.resolve([{
        entityId: "env=prod",
        maxBudgetMicrodollars: 10_000_000, spendMicrodollars: 1_000_000,
        policy: "strict_block", resetInterval: null, currentPeriodStart: null,
      }]);
    });
    mockGetDb.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: "key-1", userId: "user-1", tags: { env: "prod" },
    });

    expect(result).toHaveLength(3);
    expect(result[0].entityType).toBe("api_key");
    expect(result[1].entityType).toBe("user");
    expect(result[2].entityType).toBe("tag");
  });
});
