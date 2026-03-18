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

import { checkBudget, reconcileBudget, resolveBudgetMode, parseShadowSampleRate } from "../lib/budget-orchestrator.js";
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

describe("checkBudget — shadow mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

describe("shadow mode — divergence logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDoBudgetPopulate.mockResolvedValue(undefined);
    mockResetBudgetPeriod.mockResolvedValue(undefined);
  });

  it("logs WARN for approved-vs-denied divergence with rich detail", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    // DO returns denied
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

    // Wait for the microtask to flush
    await new Promise((r) => setTimeout(r, 10));

    expect(warnSpy).toHaveBeenCalledWith(
      "[budget-shadow] STRICT divergence",
      expect.objectContaining({
        redisStatus: "approved",
        doStatus: "denied",
        doSpend: 49_000_000,
        doMaxBudget: 50_000_000,
      }),
    );
    expect(infoSpy).not.toHaveBeenCalledWith(
      "[budget-shadow] Divergence",
      expect.anything(),
    );

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("logs INFO for skipped-vs-approved divergence with rich detail", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
    // DO returns skipped (no entities)
    mockLookupBudgetsForDO.mockResolvedValue([]);

    await checkBudget("shadow", makeEnv({ SHADOW_SAMPLE_RATE: "1.0" }), makeCtx(), 5_000_000);

    await new Promise((r) => setTimeout(r, 10));

    expect(infoSpy).toHaveBeenCalledWith(
      "[budget-shadow] Divergence",
      expect.objectContaining({ redisStatus: "approved", doStatus: "skipped" }),
    );
    // Should NOT be a strict (warn) divergence
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[budget-shadow] STRICT divergence",
      expect.anything(),
    );

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("does not log when statuses match (silent on match)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
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

    expect(warnSpy).not.toHaveBeenCalledWith(
      "[budget-shadow] STRICT divergence",
      expect.anything(),
    );
    expect(infoSpy).not.toHaveBeenCalledWith(
      "[budget-shadow] Divergence",
      expect.anything(),
    );
    // Also no console.log for matches
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("[budget-shadow]"),
      expect.anything(),
    );

    warnSpy.mockRestore();
    infoSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("divergence detail includes spend, maxBudget, reserved, remaining from both sides", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockLookupBudgets.mockResolvedValue([keyEntity]);
    mockCheckAndReserve.mockResolvedValue({ status: "approved", reservationId: "rsv-1" });
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

    const call = warnSpy.mock.calls.find(
      (c) => c[0] === "[budget-shadow] STRICT divergence",
    );
    expect(call).toBeDefined();
    const detail = call![1] as Record<string, unknown>;
    expect(detail).toHaveProperty("redisSpend");
    expect(detail).toHaveProperty("doSpend");
    expect(detail).toHaveProperty("redisMaxBudget");
    expect(detail).toHaveProperty("doMaxBudget");
    expect(detail).toHaveProperty("redisReserved");
    expect(detail).toHaveProperty("doReserved");
    expect(detail).toHaveProperty("redisRemaining");
    expect(detail).toHaveProperty("doRemaining");

    warnSpy.mockRestore();
  });
});
