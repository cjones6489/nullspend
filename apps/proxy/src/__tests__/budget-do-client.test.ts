import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockUpdateBudgetSpend, mockEmitMetric } = vi.hoisted(() => ({
  mockUpdateBudgetSpend: vi.fn(),
  mockEmitMetric: vi.fn(),
}));

vi.mock("../lib/budget-spend.js", () => ({
  updateBudgetSpend: (...args: unknown[]) => mockUpdateBudgetSpend(...args),
}));

vi.mock("../lib/metrics.js", () => ({
  emitMetric: (...args: unknown[]) => mockEmitMetric(...args),
}));

vi.mock("../durable-objects/user-budget.js", () => ({}));

import { doBudgetCheck, doBudgetReconcile, doBudgetPopulate, doBudgetRemove, doBudgetResetSpend } from "../lib/budget-do-client.js";

function makeStub(overrides: Record<string, unknown> = {}) {
  return {
    checkAndReserve: vi.fn().mockResolvedValue({ status: "approved", reservationId: "rsv-1" }),
    reconcile: vi.fn().mockResolvedValue({ status: "reconciled" }),
    populateIfEmpty: vi.fn().mockResolvedValue(true),
    syncBudgets: vi.fn().mockResolvedValue(0),
    removeBudget: vi.fn().mockResolvedValue(undefined),
    resetSpend: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeEnv(stub: ReturnType<typeof makeStub>): Env {
  return {
    USER_BUDGET: {
      idFromName: vi.fn().mockReturnValue("do-id"),
      get: vi.fn().mockReturnValue(stub),
    },
  } as unknown as Env;
}

describe("doBudgetCheck", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls stub.checkAndReserve and returns CheckResult", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);

    const result = await doBudgetCheck(
      env,
      "user-1",
      [{ type: "user", id: "user-1" }],
      5_000_000,
    );

    expect(stub.checkAndReserve).toHaveBeenCalledWith(
      [{ type: "user", id: "user-1" }],
      5_000_000,
    );
    expect(result).toEqual({ status: "approved", reservationId: "rsv-1" });
  });

  it("returns denied result from DO", async () => {
    const stub = makeStub({
      checkAndReserve: vi.fn().mockResolvedValue({
        status: "denied",
        deniedEntity: "user:user-1",
        remaining: 100,
        maxBudget: 50_000_000,
        spend: 49_999_900,
      }),
    });
    const env = makeEnv(stub);

    const result = await doBudgetCheck(env, "user-1", [{ type: "user", id: "user-1" }], 5_000_000);

    expect(result.status).toBe("denied");
    expect(result.deniedEntity).toBe("user:user-1");
  });

  it("throws on DO error (fail-closed)", async () => {
    const stub = makeStub({
      checkAndReserve: vi.fn().mockRejectedValue(new Error("DO unavailable")),
    });
    const env = makeEnv(stub);

    await expect(
      doBudgetCheck(env, "user-1", [{ type: "user", id: "user-1" }], 5_000_000),
    ).rejects.toThrow("DO unavailable");
  });
});

describe("doBudgetReconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateBudgetSpend.mockResolvedValue(undefined);
  });

  it("calls stub.reconcile + updateBudgetSpend", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);

    await doBudgetReconcile(
      env,
      "user-1",
      "rsv-1",
      1_000,
      [{ entityType: "user", entityId: "user-1" }],
      "postgres://test",
    );

    expect(stub.reconcile).toHaveBeenCalledWith("rsv-1", 1_000);
    expect(mockUpdateBudgetSpend).toHaveBeenCalledWith(
      "postgres://test",
      [{ entityType: "user", entityId: "user-1" }],
      1_000,
    );
  });

  it("skips updateBudgetSpend when actualCost=0", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);

    await doBudgetReconcile(
      env, "user-1", "rsv-1", 0,
      [{ entityType: "user", entityId: "user-1" }],
      "postgres://test",
    );

    expect(stub.reconcile).toHaveBeenCalledWith("rsv-1", 0);
    expect(mockUpdateBudgetSpend).not.toHaveBeenCalled();
  });

  it("returns 'error' on DO error", async () => {
    const stub = makeStub({
      reconcile: vi.fn().mockRejectedValue(new Error("DO error")),
    });
    const env = makeEnv(stub);

    await expect(
      doBudgetReconcile(env, "user-1", "rsv-1", 1_000, [{ entityType: "user", entityId: "user-1" }], "postgres://test"),
    ).resolves.toBe("error");
  });

  it("returns 'pg_failed' on Postgres error (retries exhausted)", async () => {
    vi.useFakeTimers();
    const stub = makeStub();
    const env = makeEnv(stub);
    mockUpdateBudgetSpend.mockRejectedValue(new Error("PG error"));

    const promise = doBudgetReconcile(env, "user-1", "rsv-1", 500, [{ entityType: "user", entityId: "user-1" }], "postgres://test");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(promise).resolves.toBe("pg_failed");
    vi.useRealTimers();
  });

  it("retries Postgres write and succeeds on second attempt", async () => {
    vi.useFakeTimers();
    const stub = makeStub();
    const env = makeEnv(stub);
    mockUpdateBudgetSpend
      .mockRejectedValueOnce(new Error("PG transient"))
      .mockResolvedValueOnce(undefined);

    const promise = doBudgetReconcile(
      env, "user-1", "rsv-1", 1_000,
      [{ entityType: "user", entityId: "user-1" }],
      "postgres://test",
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await promise;

    expect(mockUpdateBudgetSpend).toHaveBeenCalledTimes(2);
    expect(mockEmitMetric).toHaveBeenCalledWith("do_reconciliation", expect.objectContaining({
      status: "ok",
      retries: 1,
    }));
    vi.useRealTimers();
  });

  it("all retries exhausted → structured error + split-brain warning + metric", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = makeStub();
    const env = makeEnv(stub);
    mockUpdateBudgetSpend.mockRejectedValue(new Error("PG persistent"));

    const promise = doBudgetReconcile(
      env, "user-1", "rsv-1", 1_000,
      [{ entityType: "user", entityId: "user-1" }],
      "postgres://test",
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await promise;

    // 3 attempts total (0, 1, 2)
    expect(mockUpdateBudgetSpend).toHaveBeenCalledTimes(3);

    // Structured error logged
    expect(errorSpy).toHaveBeenCalledWith(
      "[budget-do-client] Postgres write failed after retries",
      expect.objectContaining({ reservationId: "rsv-1" }),
    );

    // Split-brain warning logged
    expect(errorSpy).toHaveBeenCalledWith(
      "[budget-do-client] DO/Postgres split-brain: reservation",
      "rsv-1",
    );

    // Metric emitted with pg_failed status
    expect(mockEmitMetric).toHaveBeenCalledWith("do_reconciliation", expect.objectContaining({
      status: "pg_failed",
      retries: 2,
    }));

    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  it("DO stub.reconcile failure → error status returned, Postgres write skipped", async () => {
    const stub = makeStub({
      reconcile: vi.fn().mockRejectedValue(new Error("DO error")),
    });
    const env = makeEnv(stub);

    const result = await doBudgetReconcile(
      env, "user-1", "rsv-1", 1_000,
      [{ entityType: "user", entityId: "user-1" }],
      "postgres://test",
    );

    expect(result).toBe("error");
    expect(mockUpdateBudgetSpend).not.toHaveBeenCalled();
    expect(mockEmitMetric).toHaveBeenCalledWith("do_reconciliation", expect.objectContaining({
      status: "error",
    }));
  });

  it("emits do_reconciliation metric on every call", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);

    await doBudgetReconcile(
      env, "user-1", "rsv-1", 1_000,
      [{ entityType: "user", entityId: "user-1" }],
      "postgres://test",
    );

    expect(mockEmitMetric).toHaveBeenCalledWith("do_reconciliation", expect.objectContaining({
      status: "ok",
      costMicrodollars: 1_000,
      durationMs: expect.any(Number),
      retries: 0,
    }));
  });

  it("emits metric even when actualCost=0 (no Postgres write)", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);

    await doBudgetReconcile(
      env, "user-1", "rsv-1", 0,
      [{ entityType: "user", entityId: "user-1" }],
      "postgres://test",
    );

    expect(mockEmitMetric).toHaveBeenCalledWith("do_reconciliation", expect.objectContaining({
      status: "ok",
      costMicrodollars: 0,
    }));
  });

  it("returns 'ok' on successful reconciliation", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);

    const result = await doBudgetReconcile(
      env, "user-1", "rsv-1", 1_000,
      [{ entityType: "user", entityId: "user-1" }],
      "postgres://test",
    );

    expect(result).toBe("ok");
  });

  it("returns 'ok' when actualCost=0", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);

    const result = await doBudgetReconcile(
      env, "user-1", "rsv-1", 0,
      [{ entityType: "user", entityId: "user-1" }],
      "postgres://test",
    );

    expect(result).toBe("ok");
  });
});

describe("doBudgetRemove", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls stub.removeBudget with correct args", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);

    await doBudgetRemove(env, "user-1", "api_key", "key-1");

    expect(stub.removeBudget).toHaveBeenCalledWith("api_key", "key-1");
  });

  it("throws on DO error (fail-closed)", async () => {
    const stub = makeStub({
      removeBudget: vi.fn().mockRejectedValue(new Error("DO error")),
    });
    const env = makeEnv(stub);

    await expect(
      doBudgetRemove(env, "user-1", "api_key", "key-1"),
    ).rejects.toThrow("DO error");
  });
});

describe("doBudgetResetSpend", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls stub.resetSpend with correct args", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);

    await doBudgetResetSpend(env, "user-1", "user", "user-1");

    expect(stub.resetSpend).toHaveBeenCalledWith("user", "user-1");
  });

  it("throws on DO error (fail-closed)", async () => {
    const stub = makeStub({
      resetSpend: vi.fn().mockRejectedValue(new Error("DO error")),
    });
    const env = makeEnv(stub);

    await expect(
      doBudgetResetSpend(env, "user-1", "user", "user-1"),
    ).rejects.toThrow("DO error");
  });
});

describe("doBudgetPopulate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls stub.syncBudgets with mapped entity array", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);

    await doBudgetPopulate(env, "user-1", [
      {
        entityType: "user",
        entityId: "user-1",
        maxBudget: 50_000_000,
        spend: 10_000_000,
        policy: "strict_block",
        resetInterval: "monthly",
        periodStart: 1_700_000_000_000,
      },
      {
        entityType: "api_key",
        entityId: "key-1",
        maxBudget: 10_000_000,
        spend: 0,
        policy: "warn",
        resetInterval: null,
        periodStart: 0,
      },
    ]);

    expect(stub.syncBudgets).toHaveBeenCalledTimes(1);
    expect(stub.syncBudgets).toHaveBeenCalledWith([
      {
        entityType: "user",
        entityId: "user-1",
        maxBudget: 50_000_000,
        spend: 10_000_000,
        policy: "strict_block",
        resetInterval: "monthly",
        periodStart: 1_700_000_000_000,
      },
      {
        entityType: "api_key",
        entityId: "key-1",
        maxBudget: 10_000_000,
        spend: 0,
        policy: "warn",
        resetInterval: null,
        periodStart: 0,
      },
    ]);
  });

  it("calls stub.syncBudgets with empty array", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);

    await doBudgetPopulate(env, "user-1", []);

    expect(stub.syncBudgets).toHaveBeenCalledWith([]);
  });

  it("emits do_ghost_budget_purge metric when purged > 0", async () => {
    const stub = makeStub({ syncBudgets: vi.fn().mockResolvedValue(3) });
    const env = makeEnv(stub);

    await doBudgetPopulate(env, "user-1", []);

    expect(mockEmitMetric).toHaveBeenCalledWith("do_ghost_budget_purge", {
      userId: "user-1",
      purged: 3,
    });
  });

  it("does not emit metric when purged = 0", async () => {
    const stub = makeStub({ syncBudgets: vi.fn().mockResolvedValue(0) });
    const env = makeEnv(stub);

    await doBudgetPopulate(env, "user-1", [
      {
        entityType: "user",
        entityId: "user-1",
        maxBudget: 50_000_000,
        spend: 0,
        policy: "strict_block",
        resetInterval: null,
        periodStart: 0,
      },
    ]);

    expect(mockEmitMetric).not.toHaveBeenCalledWith(
      "do_ghost_budget_purge",
      expect.anything(),
    );
  });
});
