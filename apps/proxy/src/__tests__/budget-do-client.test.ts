import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockUpdateBudgetSpend } = vi.hoisted(() => ({
  mockUpdateBudgetSpend: vi.fn(),
}));

vi.mock("../lib/budget-spend.js", () => ({
  updateBudgetSpend: (...args: unknown[]) => mockUpdateBudgetSpend(...args),
}));

vi.mock("../durable-objects/user-budget.js", () => ({}));

import { doBudgetCheck, doBudgetReconcile, doBudgetPopulate } from "../lib/budget-do-client.js";

function makeStub(overrides: Record<string, unknown> = {}) {
  return {
    checkAndReserve: vi.fn().mockResolvedValue({ status: "approved", reservationId: "rsv-1" }),
    reconcile: vi.fn().mockResolvedValue({ status: "reconciled" }),
    populateIfEmpty: vi.fn().mockResolvedValue(true),
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

  it("never throws on DO error", async () => {
    const stub = makeStub({
      reconcile: vi.fn().mockRejectedValue(new Error("DO error")),
    });
    const env = makeEnv(stub);

    await expect(
      doBudgetReconcile(env, "user-1", "rsv-1", 1_000, [{ entityType: "user", entityId: "user-1" }], "postgres://test"),
    ).resolves.toBeUndefined();
  });

  it("never throws on Postgres error", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);
    mockUpdateBudgetSpend.mockRejectedValue(new Error("PG error"));

    await expect(
      doBudgetReconcile(env, "user-1", "rsv-1", 500, [{ entityType: "user", entityId: "user-1" }], "postgres://test"),
    ).resolves.toBeUndefined();
  });
});

describe("doBudgetPopulate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls populateIfEmpty for each entity", async () => {
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

    expect(stub.populateIfEmpty).toHaveBeenCalledTimes(2);
    expect(stub.populateIfEmpty).toHaveBeenCalledWith(
      "user", "user-1", 50_000_000, 10_000_000, "strict_block", "monthly", 1_700_000_000_000,
    );
    expect(stub.populateIfEmpty).toHaveBeenCalledWith(
      "api_key", "key-1", 10_000_000, 0, "warn", null, 0,
    );
  });

  it("handles empty entities array", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);

    await doBudgetPopulate(env, "user-1", []);

    expect(stub.populateIfEmpty).not.toHaveBeenCalled();
  });
});
