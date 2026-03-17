/**
 * Budget Lookup Unit Tests
 *
 * Tests lookupBudgets in isolation with mocked Redis pipeline, Postgres
 * (pg Client + Drizzle), and populateCache. Validates cache fast-path,
 * negative caching, Postgres slow-path, and error propagation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockPopulateCache,
  mockConnect,
  mockEnd,
  mockOn,
  mockSelectChain,
} = vi.hoisted(() => {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  return {
    mockPopulateCache: vi.fn(),
    mockConnect: vi.fn(),
    mockEnd: vi.fn(),
    mockOn: vi.fn(),
    mockSelectChain: chain,
  };
});

vi.mock("../lib/budget.js", () => ({
  populateCache: (...args: unknown[]) => mockPopulateCache(...args),
}));

vi.mock("../lib/db-semaphore.js", () => ({
  withDbConnection: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("pg", () => {
  return {
    Client: function MockClient() {
      return { connect: mockConnect, end: mockEnd, on: mockOn };
    },
  };
});

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn(() => ({
    select: vi.fn().mockReturnValue(mockSelectChain),
  })),
}));

vi.mock("drizzle-orm", () => {
  const sqlTagFn = (..._args: unknown[]) => ({ as: () => "NOW()" });
  return {
    sql: sqlTagFn,
    eq: vi.fn((_col: unknown, val: unknown) => val),
    and: vi.fn((...args: unknown[]) => args),
    getTableColumns: vi.fn(() => ({
      id: "id",
      entityType: "entityType",
      entityId: "entityId",
      maxBudgetMicrodollars: "maxBudgetMicrodollars",
      spendMicrodollars: "spendMicrodollars",
      policy: "policy",
      resetInterval: "resetInterval",
      currentPeriodStart: "currentPeriodStart",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    })),
  };
});

vi.mock("@nullspend/db", () => ({
  budgets: {
    entityType: "entityType",
    entityId: "entityId",
  },
}));

import { lookupBudgets } from "../lib/budget-lookup.js";

function makeFakeRedis(pipelineResults: unknown[] = []) {
  const pipelineOps: unknown[] = [];
  const pipeline = {
    hgetall: vi.fn((key: string) => { pipelineOps.push({ op: "hgetall", key }); }),
    get: vi.fn((key: string) => { pipelineOps.push({ op: "get", key }); }),
    exec: vi.fn().mockResolvedValue(pipelineResults),
  };
  return {
    pipeline: vi.fn(() => pipeline),
    set: vi.fn().mockResolvedValue("OK"),
    _pipeline: pipeline,
  };
}

const CONNECTION_STRING = "postgresql://postgres:postgres@db.example.com:5432/postgres";

describe("lookupBudgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    mockPopulateCache.mockResolvedValue(1);
  });

  it("returns empty array when both keyId and userId are null", async () => {
    const redis = makeFakeRedis() as any;
    const result = await lookupBudgets(redis, CONNECTION_STRING, { keyId: null, userId: null });
    expect(result).toEqual([]);
    expect(redis.pipeline).not.toHaveBeenCalled();
  });

  it("returns cached budget from Redis hash (fast path)", async () => {
    const redis = makeFakeRedis([
      { maxBudget: 50_000_000, spend: 10_000_000, reserved: 0, policy: "strict_block" },
      null, // noneKey
    ]) as any;

    const result = await lookupBudgets(redis, CONNECTION_STRING, { keyId: "key-1", userId: null });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      entityKey: "{budget}:api_key:key-1",
      entityType: "api_key",
      entityId: "key-1",
      maxBudget: 50_000_000,
      spend: 10_000_000,
      reserved: 0,
      policy: "strict_block",
    });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("returns empty when negative cache marker exists", async () => {
    const redis = makeFakeRedis([
      null, // hash empty
      "1", // noneKey marker
    ]) as any;

    const result = await lookupBudgets(redis, CONNECTION_STRING, { keyId: "key-no-budget", userId: null });

    expect(result).toHaveLength(0);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("skips Postgres when all entities hit cache", async () => {
    const redis = makeFakeRedis([
      { maxBudget: 50_000_000, spend: 5_000_000, reserved: 100_000, policy: "strict_block" },
      null,
      { maxBudget: 10_000_000, spend: 1_000_000, reserved: 0, policy: "strict_block" },
      null,
    ]) as any;

    const result = await lookupBudgets(redis, CONNECTION_STRING, { keyId: "key-1", userId: "user-1" });

    expect(result).toHaveLength(2);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("queries Postgres on cache miss and calls populateCache with correct args", async () => {
    const redis = makeFakeRedis([null, null]) as any;

    const pgRow = {
      id: "budget-1",
      entityType: "api_key",
      entityId: "key-miss",
      maxBudgetMicrodollars: 25_000_000,
      spendMicrodollars: 3_000_000,
      policy: "strict_block",
      resetInterval: null,
      currentPeriodStart: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockSelectChain.where.mockResolvedValueOnce([pgRow]);

    const result = await lookupBudgets(redis, CONNECTION_STRING, { keyId: "key-miss", userId: null });

    expect(mockConnect).toHaveBeenCalled();
    expect(mockPopulateCache).toHaveBeenCalledWith(
      redis,
      "{budget}:api_key:key-miss",
      25_000_000,
      3_000_000,
      "strict_block",
      60,
    );
    expect(result).toHaveLength(1);
    expect(result[0].maxBudget).toBe(25_000_000);
    expect(result[0].reserved).toBe(0);
    expect(mockEnd).toHaveBeenCalled();
  });

  it("sets negative cache marker when Postgres returns no budget", async () => {
    const redis = makeFakeRedis([null, null]) as any;
    mockSelectChain.where.mockResolvedValueOnce([]);

    const result = await lookupBudgets(redis, CONNECTION_STRING, { keyId: "key-none", userId: null });

    expect(result).toHaveLength(0);
    expect(redis.set).toHaveBeenCalledWith(
      "{budget}:api_key:key-none:none",
      "1",
      { ex: 60 },
    );
    expect(mockEnd).toHaveBeenCalled();
  });

  it("handles partial cache (key cached, user miss)", async () => {
    const redis = makeFakeRedis([
      { maxBudget: 50_000_000, spend: 5_000_000, reserved: 0, policy: "strict_block" },
      null,
      null,
      null,
    ]) as any;

    const pgRow = {
      id: "budget-user",
      entityType: "user",
      entityId: "user-miss",
      maxBudgetMicrodollars: 10_000_000,
      spendMicrodollars: 500_000,
      policy: "strict_block",
      resetInterval: "monthly",
      currentPeriodStart: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockSelectChain.where.mockResolvedValueOnce([pgRow]);

    const result = await lookupBudgets(redis, CONNECTION_STRING, { keyId: "key-cached", userId: "user-miss" });

    expect(result).toHaveLength(2);
    expect(result[0].entityType).toBe("api_key");
    expect(result[0].maxBudget).toBe(50_000_000);
    expect(result[1].entityType).toBe("user");
    expect(result[1].maxBudget).toBe(10_000_000);
    expect(mockPopulateCache).toHaveBeenCalledTimes(1);
  });

  it("rethrows Postgres connection errors (fail-closed)", async () => {
    const redis = makeFakeRedis([null, null]) as any;
    mockConnect.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(
      lookupBudgets(redis, CONNECTION_STRING, { keyId: "key-1", userId: null }),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("populateCache failure during slow path propagates (fail-closed)", async () => {
    const redis = makeFakeRedis([null, null]) as any;

    const pgRow = {
      id: "budget-1",
      entityType: "api_key",
      entityId: "key-1",
      maxBudgetMicrodollars: 50_000_000,
      spendMicrodollars: 0,
      policy: "strict_block",
      resetInterval: null,
      currentPeriodStart: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockSelectChain.where.mockResolvedValueOnce([pgRow]);
    mockPopulateCache.mockRejectedValueOnce(new Error("Redis EVALSHA failed"));

    await expect(
      lookupBudgets(redis, CONNECTION_STRING, { keyId: "key-1", userId: null }),
    ).rejects.toThrow("Redis EVALSHA failed");
    expect(mockEnd).toHaveBeenCalled();
  });

  it("treats Redis hash without maxBudget field as cache miss", async () => {
    const redis = makeFakeRedis([
      { spend: 1000, reserved: 0 }, // corrupt: missing maxBudget
      null,
    ]) as any;

    mockSelectChain.where.mockResolvedValueOnce([]);

    const result = await lookupBudgets(redis, CONNECTION_STRING, { keyId: "key-corrupt", userId: null });

    expect(result).toHaveLength(0);
    expect(mockConnect).toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledWith(
      "{budget}:api_key:key-corrupt:none",
      "1",
      { ex: 60 },
    );
  });

  it("Number() coercion handles string values from Redis", async () => {
    const redis = makeFakeRedis([
      { maxBudget: "50000000", spend: "10000000", reserved: "500000", policy: "strict_block" },
      null,
    ]) as any;

    const result = await lookupBudgets(redis, CONNECTION_STRING, { keyId: "key-str", userId: null });

    expect(result[0].maxBudget).toBe(50_000_000);
    expect(result[0].spend).toBe(10_000_000);
    expect(result[0].reserved).toBe(500_000);
    expect(typeof result[0].maxBudget).toBe("number");
  });

  it("closes Postgres client in finally block even when query throws", async () => {
    const redis = makeFakeRedis([null, null]) as any;

    mockSelectChain.where.mockRejectedValueOnce(new Error("query timeout"));

    await expect(
      lookupBudgets(redis, CONNECTION_STRING, { keyId: "key-err", userId: null }),
    ).rejects.toThrow("query timeout");

    expect(mockEnd).toHaveBeenCalled();
  });
});
