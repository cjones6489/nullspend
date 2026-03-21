import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockWithDbConnection, mockDrizzle } = vi.hoisted(() => ({
  mockWithDbConnection: vi.fn(),
  mockDrizzle: vi.fn(),
}));

vi.mock("../lib/db-semaphore.js", () => ({
  withDbConnection: (fn: () => Promise<unknown>) => mockWithDbConnection(fn),
}));

vi.mock("pg", () => ({
  Client: function MockClient() {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      end: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
  },
}));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: () => mockDrizzle(),
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

describe("lookupBudgetsForDO", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithDbConnection.mockImplementation(async (fn: () => Promise<unknown>) => fn());
  });

  it("returns entities with all DO-required fields", async () => {
    const periodDate = new Date("2025-03-01T00:00:00Z");
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{
        maxBudgetMicrodollars: 50_000_000,
        spendMicrodollars: 10_000_000,
        policy: "strict_block",
        resetInterval: "monthly",
        currentPeriodStart: periodDate,
      }]),
    };
    mockDrizzle.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null,
      userId: "user-1",
      tags: {},
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
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{
        maxBudgetMicrodollars: 50_000_000,
        spendMicrodollars: 10_000_000,
        policy: "strict_block",
        resetInterval: "monthly",
        currentPeriodStart: new Date("2025-03-01T00:00:00Z"),
        velocityLimitMicrodollars: 5_000_000,
        velocityWindowSeconds: 120,
        velocityCooldownSeconds: 90,
      }]),
    };
    mockDrizzle.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null,
      userId: "user-1",
      tags: {},
    });

    expect(result[0].velocityLimit).toBe(5_000_000);
    expect(result[0].velocityWindow).toBe(120_000); // 120s * 1000
    expect(result[0].velocityCooldown).toBe(90_000); // 90s * 1000
  });

  it("defaults velocity window and cooldown to 60s when null", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{
        maxBudgetMicrodollars: 50_000_000,
        spendMicrodollars: 0,
        policy: "strict_block",
        resetInterval: null,
        currentPeriodStart: null,
        velocityLimitMicrodollars: null,
        velocityWindowSeconds: null,
        velocityCooldownSeconds: null,
      }]),
    };
    mockDrizzle.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null,
      userId: "user-1",
      tags: {},
    });

    expect(result[0].velocityLimit).toBeNull();
    expect(result[0].velocityWindow).toBe(60_000); // default 60s * 1000
    expect(result[0].velocityCooldown).toBe(60_000); // default 60s * 1000
  });

  it("converts timestamp to epoch ms", async () => {
    const date = new Date("2025-06-15T12:00:00Z");
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{
        maxBudgetMicrodollars: 100_000,
        spendMicrodollars: 0,
        policy: "warn",
        resetInterval: "daily",
        currentPeriodStart: date,
      }]),
    };
    mockDrizzle.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: "key-1",
      userId: null,
      tags: {},
    });

    expect(result[0].periodStart).toBe(date.getTime());
  });

  it("handles null currentPeriodStart (→ 0)", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{
        maxBudgetMicrodollars: 100_000,
        spendMicrodollars: 0,
        policy: "strict_block",
        resetInterval: null,
        currentPeriodStart: null,
      }]),
    };
    mockDrizzle.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null,
      userId: "user-1",
      tags: {},
    });

    expect(result[0].periodStart).toBe(0);
  });

  it("handles null resetInterval (→ null)", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{
        maxBudgetMicrodollars: 100_000,
        spendMicrodollars: 0,
        policy: "strict_block",
        resetInterval: null,
        currentPeriodStart: new Date("2025-01-01"),
      }]),
    };
    mockDrizzle.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null,
      userId: "user-1",
      tags: {},
    });

    expect(result[0].resetInterval).toBeNull();
  });

  it("returns empty array when no budgets found", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    mockDrizzle.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null,
      userId: "user-1",
      tags: {},
    });

    expect(result).toEqual([]);
  });

  it("throws on Postgres error (fail-closed)", async () => {
    mockWithDbConnection.mockRejectedValue(new Error("connection refused"));

    await expect(
      lookupBudgetsForDO("postgres://test", { keyId: null, userId: "user-1", tags: {} }),
    ).rejects.toThrow("connection refused");
  });

  it("skips entities where identity field is null", async () => {
    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null,
      userId: null,
      tags: {},
    });

    expect(result).toEqual([]);
    expect(mockWithDbConnection).not.toHaveBeenCalled();
  });

  // ── Tag budget lookup ─────────────────────────────────────────────

  it("returns tag budget entities when tags match", async () => {
    const periodDate = new Date("2025-06-01T00:00:00Z");
    let callCount = 0;
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation(() => {
        callCount++;
        // First call: user entity lookup
        if (callCount === 1) {
          return Promise.resolve([{
            maxBudgetMicrodollars: 100_000_000,
            spendMicrodollars: 20_000_000,
            policy: "strict_block",
            resetInterval: "monthly",
            currentPeriodStart: periodDate,
          }]);
        }
        // Second call: tag budget lookup
        return Promise.resolve([{
          entityId: "project=openclaw",
          maxBudgetMicrodollars: 50_000_000,
          spendMicrodollars: 5_000_000,
          policy: "strict_block",
          resetInterval: null,
          currentPeriodStart: null,
        }]);
      }),
    };
    mockDrizzle.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null,
      userId: "user-1",
      tags: { project: "openclaw" },
    });

    expect(result).toHaveLength(2);
    expect(result[0].entityType).toBe("user");
    expect(result[1]).toEqual({
      entityType: "tag",
      entityId: "project=openclaw",
      maxBudget: 50_000_000,
      spend: 5_000_000,
      policy: "strict_block",
      resetInterval: null,
      periodStart: 0,
      velocityLimit: null,
      velocityWindow: 60_000,
      velocityCooldown: 60_000,
      thresholdPercentages: [50, 80, 90, 95],
      sessionLimit: null,
    });
  });

  it("does not query tag budgets when tags is empty", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{
        maxBudgetMicrodollars: 100_000,
        spendMicrodollars: 0,
        policy: "strict_block",
        resetInterval: null,
        currentPeriodStart: null,
      }]),
    };
    mockDrizzle.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null,
      userId: "user-1",
      tags: {},
    });

    // Only one query for user entity, no tag query
    expect(result).toHaveLength(1);
    expect(mockDb.where).toHaveBeenCalledTimes(1);
  });

  it("does not query tag budgets when userId is null", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{
        maxBudgetMicrodollars: 100_000,
        spendMicrodollars: 0,
        policy: "strict_block",
        resetInterval: null,
        currentPeriodStart: null,
      }]),
    };
    mockDrizzle.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: "key-1",
      userId: null,
      tags: { project: "openclaw" },
    });

    // Only one query for api_key entity, no tag query
    expect(result).toHaveLength(1);
    expect(mockDb.where).toHaveBeenCalledTimes(1);
  });

  it("combines user + api_key + tag budgets in one result", async () => {
    let callCount = 0;
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // api_key entity
          return Promise.resolve([{
            maxBudgetMicrodollars: 30_000_000,
            spendMicrodollars: 5_000_000,
            policy: "strict_block",
            resetInterval: null,
            currentPeriodStart: null,
          }]);
        }
        if (callCount === 2) {
          // user entity
          return Promise.resolve([{
            maxBudgetMicrodollars: 100_000_000,
            spendMicrodollars: 20_000_000,
            policy: "strict_block",
            resetInterval: null,
            currentPeriodStart: null,
          }]);
        }
        // tag budgets
        return Promise.resolve([{
          entityId: "project=openclaw",
          maxBudgetMicrodollars: 50_000_000,
          spendMicrodollars: 0,
          policy: "strict_block",
          resetInterval: null,
          currentPeriodStart: null,
        }]);
      }),
    };
    mockDrizzle.mockReturnValue(mockDb);

    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: "key-1",
      userId: "user-1",
      tags: { project: "openclaw" },
    });

    expect(result).toHaveLength(3);
    expect(result[0].entityType).toBe("api_key");
    expect(result[1].entityType).toBe("user");
    expect(result[2].entityType).toBe("tag");
  });
});
