import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockWaitUntil,
  mockLookupBudgetsForDO,
  mockDoBudgetCheck,
  mockDoBudgetReconcile,
  mockDoBudgetPopulate,
  mockResetBudgetPeriod,
} = vi.hoisted(() => ({
  mockWaitUntil: vi.fn((p: Promise<unknown>) => { p.catch(() => {}); }),
  mockLookupBudgetsForDO: vi.fn(),
  mockDoBudgetCheck: vi.fn(),
  mockDoBudgetReconcile: vi.fn(),
  mockDoBudgetPopulate: vi.fn(),
  mockResetBudgetPeriod: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: mockWaitUntil,
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

import { checkBudget, reconcileBudget, doLookupCache } from "../lib/budget-orchestrator.js";
import type { RequestContext } from "../lib/context.js";

function makeCtx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    body: {},
    auth: { userId: "user-1", keyId: "key-1", hasBudgets: true, hasWebhooks: false },
    redis: null,
    connectionString: "postgres://test",
    sessionId: null,
    webhookDispatcher: null,
    ...overrides,
  };
}

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return {
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

    const result = await checkBudget(makeEnv(), makeCtx(), 5_000_000);

    expect(result.status).toBe("approved");
    expect(result.reservationId).toBe("rsv-do-1");
    expect(mockDoBudgetPopulate).toHaveBeenCalled();
    expect(mockDoBudgetCheck).toHaveBeenCalled();
  });

  it("builds Redis-format budgetEntities with fabricated entityKey", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-1" });

    const result = await checkBudget(makeEnv(), makeCtx(), 5_000_000);

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

    const result = await checkBudget(makeEnv(), makeCtx(), 5_000_000);

    expect(result.status).toBe("denied");
    expect(result.deniedEntityType).toBe("user");
    expect(result.deniedEntityId).toBe("user-1");
  });

  it("skipped when no budgets", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([]);

    const result = await checkBudget(makeEnv(), makeCtx(), 5_000_000);

    expect(result.status).toBe("skipped");
  });

  it("skipped when no userId", async () => {
    const ctx = makeCtx({ auth: { userId: null, keyId: "key-1", hasBudgets: true, hasWebhooks: false } });

    const result = await checkBudget(makeEnv(), ctx, 5_000_000);

    expect(result.status).toBe("skipped");
  });

  it("skipped when hasBudgets=false", async () => {
    const ctx = makeCtx({ auth: { userId: "user-1", keyId: "key-1", hasBudgets: false, hasWebhooks: false } });

    const result = await checkBudget(makeEnv(), ctx, 5_000_000);

    expect(result.status).toBe("skipped");
    expect(mockLookupBudgetsForDO).not.toHaveBeenCalled();
  });

  it("throws on DO error (fail-closed)", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockRejectedValue(new Error("DO unavailable"));

    await expect(
      checkBudget(makeEnv(), makeCtx(), 5_000_000),
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

    await checkBudget(makeEnv(), makeCtx(), 5_000_000);

    expect(mockResetBudgetPeriod).toHaveBeenCalledWith("postgres://test", resets);
  });

  it("skips resetBudgetPeriod when no periodResets", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-1" });

    await checkBudget(makeEnv(), makeCtx(), 5_000_000);

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

    const result = await checkBudget(makeEnv(), makeCtx(), 5_000_000);

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

    await checkBudget(makeEnv(), makeCtx({ connectionString: "" }), 5_000_000);

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
      makeEnv(), "user-1", "rsv-1", 1_000,
      [keyEntity], "postgres://test",
    );

    expect(mockDoBudgetReconcile).toHaveBeenCalledWith(
      expect.anything(), "user-1", "rsv-1", 1_000,
      [{ entityType: "api_key", entityId: "key-1" }],
      "postgres://test",
    );
  });

  it("handles actualCost=0 (upstream error path)", async () => {
    await reconcileBudget(
      makeEnv(), "user-1", "rsv-1", 0,
      [keyEntity], "postgres://test",
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
      reconcileBudget(makeEnv(), "user-1", "rsv-1", 1_000, [keyEntity], "postgres://test"),
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

    await checkBudget(makeEnv(), makeCtx(), 5_000_000);

    expect(mockLookupBudgetsForDO).toHaveBeenCalledTimes(1);
    expect(mockDoBudgetPopulate).toHaveBeenCalledTimes(1);
  });

  it("cache hit → skips both lookupBudgetsForDO and doBudgetPopulate", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);

    // First call: cache miss
    await checkBudget(makeEnv(), makeCtx(), 5_000_000);
    expect(mockLookupBudgetsForDO).toHaveBeenCalledTimes(1);
    expect(mockDoBudgetPopulate).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-2" });

    // Second call: cache hit
    await checkBudget(makeEnv(), makeCtx(), 5_000_000);
    expect(mockLookupBudgetsForDO).not.toHaveBeenCalled();
    expect(mockDoBudgetPopulate).not.toHaveBeenCalled();
  });

  it("cache expires after TTL → re-queries", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);

    await checkBudget(makeEnv(), makeCtx(), 5_000_000);

    // Manually expire the cache entry
    for (const [key, entry] of doLookupCache) {
      doLookupCache.set(key, { ...entry, expiresAt: Date.now() - 1 });
    }

    vi.clearAllMocks();
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-3" });
    mockDoBudgetPopulate.mockResolvedValue(undefined);

    await checkBudget(makeEnv(), makeCtx(), 5_000_000);
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
    await checkBudget(makeEnv(), makeCtx(), 5_000_000);

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
    const result1 = await checkBudget(makeEnv(), makeCtx(), 5_000_000);
    expect(result1.status).toBe("skipped");
    expect(mockLookupBudgetsForDO).toHaveBeenCalledTimes(1);

    // Cache should NOT have the empty result
    expect(doLookupCache.size).toBe(0);

    vi.clearAllMocks();
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);
    mockDoBudgetCheck.mockResolvedValue({ status: "approved", reservationId: "rsv-do-1" });
    mockDoBudgetPopulate.mockResolvedValue(undefined);

    // Second call: budgets now exist → should query Postgres again (not serve stale empty)
    const result2 = await checkBudget(makeEnv(), makeCtx(), 5_000_000);
    expect(result2.status).toBe("approved");
    expect(mockLookupBudgetsForDO).toHaveBeenCalledTimes(1);
    expect(mockDoBudgetPopulate).toHaveBeenCalledTimes(1);
  });

  it("different users get separate cache entries", async () => {
    mockLookupBudgetsForDO.mockResolvedValue([doEntity]);

    const ctx1 = makeCtx({ auth: { userId: "user-1", keyId: "key-1", hasBudgets: true, hasWebhooks: false } });
    const ctx2 = makeCtx({ auth: { userId: "user-2", keyId: "key-2", hasBudgets: true, hasWebhooks: false } });

    await checkBudget(makeEnv(), ctx1, 5_000_000);
    await checkBudget(makeEnv(), ctx2, 5_000_000);

    expect(mockLookupBudgetsForDO).toHaveBeenCalledTimes(2);
    expect(doLookupCache.size).toBe(2);
  });
});
