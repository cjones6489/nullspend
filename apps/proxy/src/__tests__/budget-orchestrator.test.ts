import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockWaitUntil,
  mockLookupBudgets,
  mockCheckAndReserve,
  mockReconcileReservation,
  mockLookupBudgetsForDO,
  mockDoBudgetCheck,
  mockDoBudgetReconcile,
  mockDoBudgetPopulate,
  mockResetBudgetPeriod,
} = vi.hoisted(() => ({
  mockWaitUntil: vi.fn((p: Promise<unknown>) => { p.catch(() => {}); }),
  mockLookupBudgets: vi.fn(),
  mockCheckAndReserve: vi.fn(),
  mockReconcileReservation: vi.fn(),
  mockLookupBudgetsForDO: vi.fn(),
  mockDoBudgetCheck: vi.fn(),
  mockDoBudgetReconcile: vi.fn(),
  mockDoBudgetPopulate: vi.fn(),
  mockResetBudgetPeriod: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: mockWaitUntil,
}));

vi.mock("../lib/budget-lookup.js", () => ({
  lookupBudgets: (...args: unknown[]) => mockLookupBudgets(...args),
}));

vi.mock("../lib/budget.js", () => ({
  checkAndReserve: (...args: unknown[]) => mockCheckAndReserve(...args),
}));

vi.mock("../lib/budget-reconcile.js", () => ({
  reconcileReservation: (...args: unknown[]) => mockReconcileReservation(...args),
}));

vi.mock("../lib/budget-do-lookup.js", () => ({
  lookupBudgetsForDO: (...args: unknown[]) => mockLookupBudgetsForDO(...args),
}));

vi.mock("../lib/budget-do-client.js", () => ({
  doBudgetCheck: (...args: unknown[]) => mockDoBudgetCheck(...args),
  doBudgetReconcile: (...args: unknown[]) => mockDoBudgetReconcile(...args),
  doBudgetPopulate: (...args: unknown[]) => mockDoBudgetPopulate(...args),
}));

vi.mock("../lib/budget-spend.js", () => ({
  updateBudgetSpend: vi.fn().mockResolvedValue(undefined),
  resetBudgetPeriod: (...args: unknown[]) => mockResetBudgetPeriod(...args),
}));

import { checkBudget, reconcileBudget, resolveBudgetMode, parseShadowSampleRate, doLookupCache } from "../lib/budget-orchestrator.js";
import type { RequestContext } from "../lib/context.js";
import { makeFakeRedis } from "./helpers/make-fake-redis.js";

function makeCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    body: {},
    auth: { userId: "user-1", keyId: "key-1", hasBudgets: true, hasWebhooks: false },
    redis: makeFakeRedis(),
    connectionString: "postgres://test",
    sessionId: null,
    webhookDispatcher: null,
    ...overrides,
  };
}

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    BUDGET_ENGINE: "redis",
    SHADOW_SAMPLE_RATE: "0.0",
    USER_BUDGET: {
      idFromName: vi.fn().mockReturnValue("do-id"),
      get: vi.fn().mockReturnValue({}),
    },
    ...overrides,
  } as unknown as Env;
}

const keyEntity = {
  entityKey: "{budget}:api_key:key-1",
  entityType: "api_key",
  entityId: "key-1",
  maxBudget: 50_000_000,
  spend: 10_000_000,
  reserved: 0,
  policy: "strict_block",
};


describe("checkBudget — redis mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReconcileReservation.mockResolvedValue(undefined);
  });

  it("lookupBudgets → checkAndReserve → correct BudgetCheckOutcome", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });

    const result = await checkBudget("redis", makeEnv(), makeCtx(), 5_000_000);

    expect(result.status).toBe("approved");
    expect(result.reservationId).toBe("rsv-1");
    expect(result.budgetEntities).toEqual([keyEntity]);
  });

  it("skipped when no budgets (hasBudgets=false)", async () => {
    const ctx = makeCtx({ auth: { userId: "user-1", keyId: "key-1", hasBudgets: false, hasWebhooks: false } });

    const result = await checkBudget("redis", makeEnv(), ctx, 5_000_000);

    expect(result.status).toBe("skipped");
    expect(mockLookupBudgets).not.toHaveBeenCalled();
  });

  it("skipped when no redis", async () => {
    const ctx = makeCtx({ redis: null });

    const result = await checkBudget("redis", makeEnv(), ctx, 5_000_000);

    expect(result.status).toBe("skipped");
  });

  it("skipped when lookupBudgets returns empty", async () => {
    mockLookupBudgets.mockResolvedValue([]);

    const result = await checkBudget("redis", makeEnv(), makeCtx(), 5_000_000);

    expect(result.status).toBe("skipped");
  });

  it("denied with entity details mapped correctly", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "denied",
      entityKey: "{budget}:api_key:key-1",
      remaining: 100,
      maxBudget: 50_000_000,
      spend: 49_999_900,
    });

    const result = await checkBudget("redis", makeEnv(), makeCtx(), 5_000_000);

    expect(result.status).toBe("denied");
    expect(result.deniedEntityType).toBe("api_key");
    expect(result.deniedEntityId).toBe("key-1");
    expect(result.remaining).toBe(100);
    expect(result.maxBudget).toBe(50_000_000);
    expect(result.spend).toBe(49_999_900);
    // reserved = maxBudget - spend - remaining = 50_000_000 - 49_999_900 - 100 = 0
    expect(result.reserved).toBe(0);
  });

  it("denied outcome computes reserved correctly with non-zero reservations", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "denied",
      entityKey: "{budget}:api_key:key-1",
      remaining: 5_000_000,
      maxBudget: 50_000_000,
      spend: 30_000_000,
    });

    const result = await checkBudget("redis", makeEnv(), makeCtx(), 20_000_000);

    // reserved = 50_000_000 - 30_000_000 - 5_000_000 = 15_000_000
    expect(result.reserved).toBe(15_000_000);
    expect((result.spend ?? 0) + (result.reserved ?? 0)).toBe(30_000_000 + 15_000_000);
  });

  it("throws on lookup error (fail-closed)", async () => {
    mockLookupBudgets.mockRejectedValue(new Error("Redis down"));

    await expect(
      checkBudget("redis", makeEnv(), makeCtx(), 5_000_000),
    ).rejects.toThrow("Redis down");
  });
});

describe("reconcileBudget — redis mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReconcileReservation.mockResolvedValue(undefined);
  });

  it("calls reconcileReservation", async () => {
    const redis = makeFakeRedis();

    await reconcileBudget("redis", makeEnv(), "user-1", "rsv-1", 1_000, [keyEntity], "postgres://test", redis);

    expect(mockReconcileReservation).toHaveBeenCalledWith(
      redis, "rsv-1", 1_000, [keyEntity], "postgres://test",
    );
  });

  it("never throws", async () => {
    mockReconcileReservation.mockRejectedValue(new Error("fail"));

    await expect(
      reconcileBudget("redis", makeEnv(), "user-1", "rsv-1", 1_000, [keyEntity], "postgres://test", makeFakeRedis()),
    ).resolves.toBeUndefined();
  });

  it("skips when no reservationId", async () => {
    await reconcileBudget("redis", makeEnv(), "user-1", null, 0, [], "postgres://test", makeFakeRedis());

    expect(mockReconcileReservation).not.toHaveBeenCalled();
  });
});

describe("checkBudget — durable-objects mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doLookupCache.clear();
    mockDoBudgetPopulate.mockResolvedValue(undefined);
    mockResetBudgetPeriod.mockResolvedValue(undefined);
  });

  const doEntity = {
    entityType: "user",
    entityId: "user-1",
    maxBudget: 100_000_000,
    spend: 20_000_000,
    policy: "strict_block",
    resetInterval: "monthly" as const,
    periodStart: 1_700_000_000_000,
  };

  it("lookupBudgetsForDO → populate → check → correct outcome", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-1" });

    const result = await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);

    expect(result.status).toBe("approved");
    expect(result.reservationId).toBe("rsv-do-1");
    expect(mockDoBudgetPopulate).toHaveBeenCalled();
    expect(mockDoBudgetCheck).toHaveBeenCalled();
  });

  it("builds Redis-format budgetEntities with fabricated entityKey", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-1" });

    const result = await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);

    expect(result.budgetEntities[0].entityKey).toBe("{budget}:user:user-1");
    expect(result.budgetEntities[0].reserved).toBe(0);
    expect(result.budgetEntities[0].maxBudget).toBe(100_000_000);
  });

  it("denied with parsed deniedEntity (type + id)", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockResolvedValue({
      status: "denied",
      deniedEntity: "user:user-1",
      remaining: 500,
      maxBudget: 100_000_000,
      spend: 99_999_500,
    });

    const result = await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);

    expect(result.status).toBe("denied");
    expect(result.deniedEntityType).toBe("user");
    expect(result.deniedEntityId).toBe("user-1");
  });

  it("skipped when no budgets", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([]);

    const result = await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);

    expect(result.status).toBe("skipped");
  });

  it("skipped when no userId", async () => {
    const ctx = makeCtx({ auth: { userId: null, keyId: "key-1", hasBudgets: true, hasWebhooks: false } });

    const result = await checkBudget("durable-objects", makeEnv(), ctx, 5_000_000);

    expect(result.status).toBe("skipped");
  });

  it("throws on DO error (fail-closed)", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockRejectedValue(new Error("DO unavailable"));

    await expect(
      checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000),
    ).rejects.toThrow("DO unavailable");
  });

  it("calls resetBudgetPeriod when periodResets present", async () => {
    const resets = [{ entityType: "user", entityId: "user-1", newPeriodStart: 1_710_000_000_000 }];
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-do-1",
      periodResets: resets,
    });

    await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);

    expect(mockResetBudgetPeriod).toHaveBeenCalledWith("postgres://test", resets);
  });

  it("skips resetBudgetPeriod when no periodResets", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-1" });

    await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);

    expect(mockResetBudgetPeriod).not.toHaveBeenCalled();
  });

  it("resetBudgetPeriod failure does not crash checkBudgetDO", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const resets = [{ entityType: "user", entityId: "user-1", newPeriodStart: 1_710_000_000_000 }];
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-do-1",
      periodResets: resets,
    });
    mockResetBudgetPeriod.mockRejectedValue(new Error("Postgres down"));

    const result = await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);

    // waitUntil catches the error — wait for microtask
    await new Promise((r) => setTimeout(r, 10));

    expect(result.status).toBe("approved");
    expect(errorSpy).toHaveBeenCalledWith(
      "[budget-orchestrator] Period reset write-back failed:",
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it("skips resetBudgetPeriod when connectionString is falsy", async () => {
    const resets = [{ entityType: "user", entityId: "user-1", newPeriodStart: 1_710_000_000_000 }];
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockResolvedValue({
      status: "approved",
      reservationId: "rsv-do-1",
      periodResets: resets,
    });

    await checkBudget("durable-objects", makeEnv(), makeCtx({ connectionString: "" }), 5_000_000);

    expect(mockResetBudgetPeriod).not.toHaveBeenCalled();
  });
});

describe("reconcileBudget — durable-objects mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDoBudgetReconcile.mockResolvedValue(undefined);
  });

  it("calls doBudgetReconcile with userId", async () => {
    await reconcileBudget(
      "durable-objects", makeEnv(), "user-1", "rsv-1", 1_000,
      [keyEntity], "postgres://test", null,
    );

    expect(mockDoBudgetReconcile).toHaveBeenCalledWith(
      expect.anything(), "user-1", "rsv-1", 1_000,
      [{ entityType: "api_key", entityId: "key-1" }],
      "postgres://test",
    );
  });

  it("handles actualCost=0 (upstream error path)", async () => {
    await reconcileBudget(
      "durable-objects", makeEnv(), "user-1", "rsv-1", 0,
      [keyEntity], "postgres://test", null,
    );

    expect(mockDoBudgetReconcile).toHaveBeenCalledWith(
      expect.anything(), "user-1", "rsv-1", 0,
      expect.any(Array),
      "postgres://test",
    );
  });

  it("never throws", async () => {
    mockDoBudgetReconcile.mockRejectedValue(new Error("DO fail"));

    await expect(
      reconcileBudget("durable-objects", makeEnv(), "user-1", "rsv-1", 1_000, [keyEntity], "postgres://test", null),
    ).resolves.toBeUndefined();
  });
});

describe("checkBudgetDO — lookup cache", () => {
  const doEntity = {
    entityType: "user",
    entityId: "user-1",
    maxBudget: 100_000_000,
    spend: 20_000_000,
    policy: "strict_block",
    resetInterval: "monthly" as const,
    periodStart: 1_700_000_000_000,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    doLookupCache.clear();
    mockDoBudgetPopulate.mockResolvedValue(undefined);
    mockResetBudgetPeriod.mockResolvedValue(undefined);
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-1" });
  });

  it("cache miss → calls lookupBudgetsForDO + doBudgetPopulate", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);

    await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);

    expect(mockLookupBudgetsForDO).toHaveBeenCalledTimes(1);
    expect(mockDoBudgetPopulate).toHaveBeenCalledTimes(1);
  });

  it("cache hit → skips both lookupBudgetsForDO and doBudgetPopulate", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);

    // First call: cache miss
    await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);
    expect(mockLookupBudgetsForDO).toHaveBeenCalledTimes(1);
    expect(mockDoBudgetPopulate).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-2" });

    // Second call: cache hit
    await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);
    expect(mockLookupBudgetsForDO).not.toHaveBeenCalled();
    expect(mockDoBudgetPopulate).not.toHaveBeenCalled();
  });

  it("cache expires after TTL → re-queries", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);

    await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);

    // Manually expire the cache entry
    for (const [key, entry] of doLookupCache) {
      doLookupCache.set(key, { ...entry, expiresAt: Date.now() - 1 });
    }

    vi.clearAllMocks();
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-3" });
    mockDoBudgetPopulate.mockResolvedValue(undefined);

    await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);
    expect(mockLookupBudgetsForDO).toHaveBeenCalledTimes(1);
    expect(mockDoBudgetPopulate).toHaveBeenCalledTimes(1);
  });

  it("evicts oldest entry when cache exceeds max size", async () => {
    // Fill cache with 256 entries (using keys that don't collide with ctx identity user-1:key-1)
    for (let i = 0; i < 256; i++) {
      doLookupCache.set(`fill-${i}:fill-${i}`, {
        entities: [doEntity],
        expiresAt: Date.now() + 60_000,
      });
    }
    expect(doLookupCache.size).toBe(256);

    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);

    // This call adds entry #257 (user-1:key-1), triggering eviction
    await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);

    // Size should be 256 (added 1 new, evicted 1 oldest)
    expect(doLookupCache.size).toBe(256);
    // First entry should have been evicted
    expect(doLookupCache.has("fill-0:fill-0")).toBe(false);
    // New entry should be present
    expect(doLookupCache.has("user-1:key-1")).toBe(true);
  });

  it("empty entities are NOT cached (avoids 60s fails-open window)", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([]);

    // First call: no budgets → skipped
    const result1 = await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);
    expect(result1.status).toBe("skipped");
    expect(mockLookupBudgetsForDO).toHaveBeenCalledTimes(1);

    // Cache should NOT have the empty result
    expect(doLookupCache.size).toBe(0);

    vi.clearAllMocks();
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-1" });
    mockDoBudgetPopulate.mockResolvedValue(undefined);

    // Second call: budgets now exist → should query Postgres again (not serve stale empty)
    const result2 = await checkBudget("durable-objects", makeEnv(), makeCtx(), 5_000_000);
    expect(result2.status).toBe("approved");
    expect(mockLookupBudgetsForDO).toHaveBeenCalledTimes(1);
    expect(mockDoBudgetPopulate).toHaveBeenCalledTimes(1);
  });

  it("different users get separate cache entries", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);

    const ctx1 = makeCtx({ auth: { userId: "user-1", keyId: "key-1", hasBudgets: true, hasWebhooks: false } });
    const ctx2 = makeCtx({ auth: { userId: "user-2", keyId: "key-2", hasBudgets: true, hasWebhooks: false } });

    await checkBudget("durable-objects", makeEnv(), ctx1, 5_000_000);
    await checkBudget("durable-objects", makeEnv(), ctx2, 5_000_000);

    expect(mockLookupBudgetsForDO).toHaveBeenCalledTimes(2);
    expect(doLookupCache.size).toBe(2);
  });
});

describe("checkBudget — shadow mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doLookupCache.clear();
    mockDoBudgetPopulate.mockResolvedValue(undefined);
    mockResetBudgetPeriod.mockResolvedValue(undefined);
  });

  it("returns Redis result as primary", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    // DO runs in background
    mockLookupBudgetsForDO.mockResolvedValue([]);

    const result = await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);

    expect(result.status).toBe("approved");
    expect(result.reservationId).toBe("rsv-1");
  });

  it("runs DO in waitUntil when sampled", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);

    expect(mockWaitUntil).toHaveBeenCalled();
  });

  it("DO error doesn't affect Redis result", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    mockLookupBudgetsForDO.mockRejectedValue(new Error("DO down"));

    const result = await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);

    expect(result.status).toBe("approved");
  });

  it("Redis failure → still throws (fail-closed on primary)", async () => {
    mockLookupBudgets.mockRejectedValue(new Error("Redis down"));

    await expect(
      checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000),
    ).rejects.toThrow("Redis down");
  });
});

describe("shadow mode — sampling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doLookupCache.clear();
    mockDoBudgetPopulate.mockResolvedValue(undefined);
    mockResetBudgetPeriod.mockResolvedValue(undefined);
  });

  it("skips DO when SHADOW_SAMPLE_RATE=0", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "0.0" }), makeCtx(), 5_000_000);

    expect(mockWaitUntil).not.toHaveBeenCalled();
    expect(mockLookupBudgetsForDO).not.toHaveBeenCalled();
  });

  it("always runs DO when SHADOW_SAMPLE_RATE=1", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    mockLookupBudgetsForDO.mockResolvedValue([]);

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);

    expect(mockWaitUntil).toHaveBeenCalled();
  });

  it("respects fractional rate via Math.random mock", async () => {
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    mockLookupBudgetsForDO.mockResolvedValue([]);

    // Math.random returns 0.3 → sampled at rate 0.5 (0.3 < 0.5)
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.3);
    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "0.5" }), makeCtx(), 5_000_000);
    expect(mockWaitUntil).toHaveBeenCalled();

    vi.clearAllMocks();
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    mockResetBudgetPeriod.mockResolvedValue(undefined);

    // Math.random returns 0.7 → not sampled at rate 0.5 (0.7 >= 0.5)
    randomSpy.mockReturnValue(0.7);
    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "0.5" }), makeCtx(), 5_000_000);
    expect(mockWaitUntil).not.toHaveBeenCalled();

    randomSpy.mockRestore();
  });
});

describe("parseShadowSampleRate", () => {
  it("parses valid rate", () => {
    expect(parseShadowSampleRate({ SHADOW_SAMPLE_RATE: "0.5" } as unknown as Env)).toBe(0.5);
  });

  it("clamps to 0 for negative value", () => {
    expect(parseShadowSampleRate({ SHADOW_SAMPLE_RATE: "-0.5" } as unknown as Env)).toBe(0);
  });

  it("clamps to 1 for value > 1", () => {
    expect(parseShadowSampleRate({ SHADOW_SAMPLE_RATE: "2.0" } as unknown as Env)).toBe(1);
  });

  it("returns 0 for NaN", () => {
    expect(parseShadowSampleRate({ SHADOW_SAMPLE_RATE: "not-a-number" } as unknown as Env)).toBe(0);
  });

  it("returns 0 when missing", () => {
    expect(parseShadowSampleRate({} as unknown as Env)).toBe(0);
  });

  it("handles '0.0' string (wrangler default)", () => {
    expect(parseShadowSampleRate({ SHADOW_SAMPLE_RATE: "0.0" } as unknown as Env)).toBe(0);
  });

  it("handles '1.0' string", () => {
    expect(parseShadowSampleRate({ SHADOW_SAMPLE_RATE: "1.0" } as unknown as Env)).toBe(1);
  });
});

describe("reconcileBudget — shadow mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReconcileReservation.mockResolvedValue(undefined);
    mockDoBudgetReconcile.mockResolvedValue(undefined);
  });

  it("only reconciles Redis, not DO", async () => {
    const redis = makeFakeRedis();

    await reconcileBudget("shadow", makeEnv(), "user-1", "rsv-1", 1_000, [keyEntity], "postgres://test", redis);

    expect(mockReconcileReservation).toHaveBeenCalledWith(
      redis, "rsv-1", 1_000, [keyEntity], "postgres://test",
    );
    expect(mockDoBudgetReconcile).not.toHaveBeenCalled();
  });

  it("never throws even if Redis fails", async () => {
    mockReconcileReservation.mockRejectedValue(new Error("Redis fail"));

    await expect(
      reconcileBudget("shadow", makeEnv(), "user-1", "rsv-1", 1_000, [keyEntity], "postgres://test", makeFakeRedis()),
    ).resolves.toBeUndefined();
  });
});

describe("resolveBudgetMode", () => {
  it("returns redis for BUDGET_ENGINE=redis", () => {
    expect(resolveBudgetMode({ BUDGET_ENGINE: "redis" } as unknown as Env)).toBe("redis");
  });

  it("returns durable-objects for BUDGET_ENGINE=durable-objects", () => {
    expect(resolveBudgetMode({ BUDGET_ENGINE: "durable-objects" } as unknown as Env)).toBe("durable-objects");
  });

  it("returns shadow for BUDGET_ENGINE=shadow", () => {
    expect(resolveBudgetMode({ BUDGET_ENGINE: "shadow" } as unknown as Env)).toBe("shadow");
  });

  it("defaults to redis when BUDGET_ENGINE is empty", () => {
    expect(resolveBudgetMode({ BUDGET_ENGINE: "" } as unknown as Env)).toBe("redis");
  });

  it("defaults to redis when BUDGET_ENGINE is undefined", () => {
    expect(resolveBudgetMode({} as unknown as Env)).toBe("redis");
  });

  it("falls back to redis and warns on invalid value", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = resolveBudgetMode({ BUDGET_ENGINE: "typo" } as unknown as Env);

    expect(result).toBe("redis");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown BUDGET_ENGINE"),
    );
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Helper: parse structured shadow metric from console.log spy
// ---------------------------------------------------------------------------

function parseShadowMetric(logSpy: ReturnType<typeof vi.spyOn>) {
  const call = logSpy.mock.calls.find((c) => {
    try { return JSON.parse(c[0])._event === "budget_shadow_sample"; }
    catch { return false; }
  });
  return call ? JSON.parse(call[0]) : null;
}

describe("shadow mode — structured metric emission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doLookupCache.clear();
    mockDoBudgetPopulate.mockResolvedValue(undefined);
    mockResetBudgetPeriod.mockResolvedValue(undefined);
  });

  it("emits structured JSON with divergenceType='strict' for approved-vs-denied", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    mockLookupBudgetsForDO.mockResolvedValue([{
      entityType: "api_key", entityId: "key-1",
      maxBudget: 50_000_000, spend: 49_000_000,
      policy: "strict_block", resetInterval: null, periodStart: 0,
    }]);
    mockDoBudgetCheck.mockResolvedValue({
      status: "denied", deniedEntity: "api_key:key-1",
      remaining: 0, maxBudget: 50_000_000, spend: 49_000_000,
    });

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);
    await new Promise((r) => setTimeout(r, 10));

    const metric = parseShadowMetric(logSpy);
    expect(metric).not.toBeNull();
    expect(metric._event).toBe("budget_shadow_sample");
    expect(metric.divergenceType).toBe("strict");
    expect(metric.redisStatus).toBe("approved");
    expect(metric.doStatus).toBe("denied");

    // Backward compat: console.warn still fired
    expect(warnSpy).toHaveBeenCalledWith(
      "[budget-shadow] STRICT divergence",
      expect.objectContaining({ redisStatus: "approved", doStatus: "denied" }),
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("emits structured JSON with divergenceType='strict' for denied-vs-approved (reverse)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "denied", entityKey: "{budget}:api_key:key-1",
      remaining: 0, maxBudget: 50_000_000, spend: 50_000_000,
    });
    // DO returns approved
    mockLookupBudgetsForDO.mockResolvedValue([{
      entityType: "api_key", entityId: "key-1",
      maxBudget: 50_000_000, spend: 10_000_000,
      policy: "strict_block", resetInterval: null, periodStart: 0,
    }]);
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-1" });

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);
    await new Promise((r) => setTimeout(r, 10));

    const metric = parseShadowMetric(logSpy);
    expect(metric).not.toBeNull();
    expect(metric.divergenceType).toBe("strict");
    expect(metric.redisStatus).toBe("denied");
    expect(metric.doStatus).toBe("approved");

    expect(warnSpy).toHaveBeenCalledWith(
      "[budget-shadow] STRICT divergence",
      expect.objectContaining({ redisStatus: "denied", doStatus: "approved" }),
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("emits structured JSON with divergenceType='soft' for skipped-vs-approved", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    mockLookupBudgetsForDO.mockResolvedValue([]);

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);
    await new Promise((r) => setTimeout(r, 10));

    const metric = parseShadowMetric(logSpy);
    expect(metric).not.toBeNull();
    expect(metric.divergenceType).toBe("soft");
    expect(metric.redisStatus).toBe("approved");
    expect(metric.doStatus).toBe("skipped");

    // No console.warn for soft divergence
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[budget-shadow] STRICT divergence",
      expect.anything(),
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("emits structured JSON with divergenceType='none' when statuses match", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    mockLookupBudgetsForDO.mockResolvedValue([{
      entityType: "api_key", entityId: "key-1",
      maxBudget: 50_000_000, spend: 10_000_000,
      policy: "strict_block", resetInterval: null, periodStart: 0,
    }]);
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-1" });

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);
    await new Promise((r) => setTimeout(r, 10));

    const metric = parseShadowMetric(logSpy);
    expect(metric).not.toBeNull();
    expect(metric._event).toBe("budget_shadow_sample");
    expect(metric.divergenceType).toBe("none");
    expect(metric.redisStatus).toBe("approved");
    expect(metric.doStatus).toBe("approved");

    // No warn for match
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[budget-shadow] STRICT divergence",
      expect.anything(),
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("divergence detail includes spend/maxBudget/remaining from both sides", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({
      status: "denied", entityKey: "{budget}:api_key:key-1",
      remaining: 100, maxBudget: 50_000_000, spend: 49_999_900,
    });
    mockLookupBudgetsForDO.mockResolvedValue([{
      entityType: "api_key", entityId: "key-1",
      maxBudget: 50_000_000, spend: 49_000_000,
      policy: "strict_block", resetInterval: null, periodStart: 0,
    }]);
    mockDoBudgetCheck.mockResolvedValue({
      status: "denied", deniedEntity: "api_key:key-1",
      remaining: 500_000, maxBudget: 50_000_000, spend: 49_000_000,
    });

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);
    await new Promise((r) => setTimeout(r, 10));

    const metric = parseShadowMetric(logSpy);
    expect(metric).not.toBeNull();
    expect(metric.redisSpend).toBe(49_999_900);
    expect(metric.doSpend).toBe(49_000_000);
    expect(metric.redisMaxBudget).toBe(50_000_000);
    expect(metric.doMaxBudget).toBe(50_000_000);
    expect(metric.redisRemaining).toBe(100);
    expect(metric.doRemaining).toBe(500_000);

    vi.restoreAllMocks();
  });

  it("includes doLatencyMs as non-negative number", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    mockLookupBudgetsForDO.mockResolvedValue([{
      entityType: "api_key", entityId: "key-1",
      maxBudget: 50_000_000, spend: 10_000_000,
      policy: "strict_block", resetInterval: null, periodStart: 0,
    }]);
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-1" });

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);
    await new Promise((r) => setTimeout(r, 10));

    const metric = parseShadowMetric(logSpy);
    expect(metric).not.toBeNull();
    expect(typeof metric.doLatencyMs).toBe("number");
    expect(metric.doLatencyMs).toBeGreaterThanOrEqual(0);

    logSpy.mockRestore();
  });

  it("DO error → doStatus='error', divergenceType='error', doError populated", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    mockLookupBudgetsForDO.mockRejectedValue(new Error("DO unavailable"));

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);
    await new Promise((r) => setTimeout(r, 10));

    const metric = parseShadowMetric(logSpy);
    expect(metric).not.toBeNull();
    expect(metric.doStatus).toBe("error");
    expect(metric.divergenceType).toBe("error");
    expect(metric.doError).toBe("DO unavailable");

    // No console.warn for error type (not strict)
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[budget-shadow] STRICT divergence",
      expect.anything(),
    );

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("event includes userId and keyId for attribution", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    mockLookupBudgetsForDO.mockResolvedValue([]);

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);
    await new Promise((r) => setTimeout(r, 10));

    const metric = parseShadowMetric(logSpy);
    expect(metric).not.toBeNull();
    expect(metric.userId).toBe("user-1");
    expect(metric.keyId).toBe("key-1");

    logSpy.mockRestore();
  });

  it("console.warn emitted for strict divergence (backward compat)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    mockLookupBudgetsForDO.mockResolvedValue([{
      entityType: "api_key", entityId: "key-1",
      maxBudget: 50_000_000, spend: 49_000_000,
      policy: "strict_block", resetInterval: null, periodStart: 0,
    }]);
    mockDoBudgetCheck.mockResolvedValue({
      status: "denied", deniedEntity: "api_key:key-1",
      remaining: 0, maxBudget: 50_000_000, spend: 49_000_000,
    });

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);
    await new Promise((r) => setTimeout(r, 10));

    expect(warnSpy).toHaveBeenCalledWith(
      "[budget-shadow] STRICT divergence",
      expect.objectContaining({
        userId: "user-1",
        redisStatus: "approved",
        doStatus: "denied",
        doLatencyMs: expect.any(Number),
      }),
    );

    vi.restoreAllMocks();
  });

  it("console.warn NOT emitted for non-strict types (soft, none, error)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    // Test soft divergence
    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    mockLookupBudgetsForDO.mockResolvedValue([]);

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);
    await new Promise((r) => setTimeout(r, 10));

    expect(warnSpy).not.toHaveBeenCalledWith(
      "[budget-shadow] STRICT divergence",
      expect.anything(),
    );

    vi.restoreAllMocks();
  });

  it("SHADOW_SAMPLE_RATE=0 emits no budget_shadow_sample events", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "0.0" }), makeCtx(), 5_000_000);
    await new Promise((r) => setTimeout(r, 10));

    const metric = parseShadowMetric(logSpy);
    expect(metric).toBeNull();
    expect(mockWaitUntil).not.toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it("event includes estimateMicrodollars and timestamp", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    mockLookupBudgetsForDO.mockResolvedValue([]);

    const before = Date.now();
    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 7_500_000);
    await new Promise((r) => setTimeout(r, 10));
    const after = Date.now();

    const metric = parseShadowMetric(logSpy);
    expect(metric).not.toBeNull();
    expect(metric.estimateMicrodollars).toBe(7_500_000);
    expect(metric.timestamp).toBeGreaterThanOrEqual(before);
    expect(metric.timestamp).toBeLessThanOrEqual(after);

    logSpy.mockRestore();
  });
});
