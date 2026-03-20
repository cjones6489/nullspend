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
  getTableColumns: vi.fn(() => ({})),
}));

vi.mock("@nullspend/db", () => ({
  budgets: {
    entityType: "entityType",
    entityId: "entityId",
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
    });
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
    });

    expect(result).toEqual([]);
  });

  it("throws on Postgres error (fail-closed)", async () => {
    mockWithDbConnection.mockRejectedValue(new Error("connection refused"));

    await expect(
      lookupBudgetsForDO("postgres://test", { keyId: null, userId: "user-1" }),
    ).rejects.toThrow("connection refused");
  });

  it("skips entities where identity field is null", async () => {
    const result = await lookupBudgetsForDO("postgres://test", {
      keyId: null,
      userId: null,
    });

    expect(result).toEqual([]);
    expect(mockWithDbConnection).not.toHaveBeenCalled();
  });
});
