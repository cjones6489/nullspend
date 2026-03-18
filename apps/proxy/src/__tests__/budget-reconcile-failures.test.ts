import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReconcile, mockUpdateBudgetSpend } = vi.hoisted(() => ({
  mockReconcile: vi.fn(),
  mockUpdateBudgetSpend: vi.fn(),
}));

vi.mock("../lib/budget.js", () => ({
  reconcile: (...args: unknown[]) => mockReconcile(...args),
}));

vi.mock("../lib/budget-spend.js", () => ({
  updateBudgetSpend: (...args: unknown[]) => mockUpdateBudgetSpend(...args),
}));

vi.mock("../lib/metrics.js", () => ({
  emitMetric: vi.fn(),
}));

import { reconcileReservation } from "../lib/budget-reconcile.js";

const mockRedis = {} as any;
const connString =
  "postgresql://postgres:postgres@db.example.com:5432/postgres";
const entities = [
  {
    entityKey: "{budget}:api_key:key-1",
    entityType: "api_key",
    entityId: "key-1",
    maxBudget: 50_000_000,
    spend: 10_000_000,
    reserved: 0,
    policy: "strict_block",
  },
  {
    entityKey: "{budget}:user:user-1",
    entityType: "user",
    entityId: "user-1",
    maxBudget: 100_000_000,
    spend: 20_000_000,
    reserved: 0,
    policy: "strict_block",
  },
];

describe("reconcileReservation – failure scenarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReconcile.mockResolvedValue({ status: "reconciled", spends: {} });
    mockUpdateBudgetSpend.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("happy path", async () => {
    const reservationId = "res-happy";
    const actualCost = 25_000;

    await reconcileReservation(
      mockRedis,
      reservationId,
      actualCost,
      entities,
      connString,
    );

    expect(mockReconcile).toHaveBeenCalledWith(
      mockRedis,
      reservationId,
      ["{budget}:api_key:key-1", "{budget}:user:user-1"],
      actualCost,
    );

    expect(mockUpdateBudgetSpend).toHaveBeenCalledWith(
      connString,
      [
        { entityType: "api_key", entityId: "key-1" },
        { entityType: "user", entityId: "user-1" },
      ],
      actualCost,
    );

    expect(console.error).not.toHaveBeenCalled();
  });

  // P0 gap: Redis spend is updated but Postgres baseline is stale.
  // With retry logic, all 3 attempts fail → structured error + split-brain warning.
  it("partial failure: Redis succeeds but Postgres fails all retries", async () => {
    mockReconcile.mockResolvedValue({ status: "reconciled", spends: {} });
    mockUpdateBudgetSpend.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      reconcileReservation(mockRedis, "res-pg-fail", 30_000, entities, connString),
    ).resolves.toBeUndefined();

    // 3 attempts: initial + 2 retries
    expect(mockUpdateBudgetSpend).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledWith(
      "[budget-reconcile] Postgres write failed after retries",
      expect.objectContaining({
        reservationId: "res-pg-fail",
        actualCostMicrodollars: 30_000,
        error: "ECONNREFUSED",
      }),
    );
    expect(console.error).toHaveBeenCalledWith(
      "[budget-reconcile] Redis/Postgres split-brain: reservation",
      "res-pg-fail",
    );
  });

  it("partial failure: Redis fails, Postgres never called", async () => {
    mockReconcile.mockRejectedValue(new Error("Redis connection failed"));

    await expect(
      reconcileReservation(
        mockRedis,
        "res-redis-fail",
        30_000,
        entities,
        connString,
      ),
    ).resolves.toBeUndefined();

    expect(mockUpdateBudgetSpend).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[budget] Reconciliation failed:",
      expect.any(Error),
    );
  });

  it("zero cost: skips Postgres write", async () => {
    await reconcileReservation(mockRedis, "res-zero", 0, entities, connString);

    expect(mockReconcile).toHaveBeenCalledWith(
      mockRedis,
      "res-zero",
      ["{budget}:api_key:key-1", "{budget}:user:user-1"],
      0,
    );

    expect(mockUpdateBudgetSpend).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  // When reservation expires: reserved amount already decremented to 0 by
  // Redis TTL cleanup, but spend was never incremented. updateBudgetSpend
  // still runs, so Postgres gets the cost, but Redis spend is behind until
  // next cache rebuild.
  it("reconcile returns not_found (TTL expired)", async () => {
    mockReconcile.mockResolvedValue({ status: "not_found" });
    const actualCost = 50_000;

    await reconcileReservation(
      mockRedis,
      "res-expired",
      actualCost,
      entities,
      connString,
    );

    expect(mockReconcile).toHaveBeenCalled();

    expect(mockUpdateBudgetSpend).toHaveBeenCalledWith(
      connString,
      [
        { entityType: "api_key", entityId: "key-1" },
        { entityType: "user", entityId: "user-1" },
      ],
      actualCost,
    );
  });

  it("multiple entities: all entity keys passed", async () => {
    const actualCost = 10_000;

    await reconcileReservation(
      mockRedis,
      "res-multi",
      actualCost,
      entities,
      connString,
    );

    expect(mockReconcile).toHaveBeenCalledWith(
      mockRedis,
      "res-multi",
      ["{budget}:api_key:key-1", "{budget}:user:user-1"],
      actualCost,
    );

    expect(mockUpdateBudgetSpend).toHaveBeenCalledWith(
      connString,
      [
        { entityType: "api_key", entityId: "key-1" },
        { entityType: "user", entityId: "user-1" },
      ],
      actualCost,
    );
  });

  it("never throws even on unexpected error", async () => {
    mockReconcile.mockRejectedValue("kaboom");

    await expect(
      reconcileReservation(
        mockRedis,
        "res-unexpected",
        10_000,
        entities,
        connString,
      ),
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      "[budget] Reconciliation failed:",
      "kaboom",
    );
  });

  it("retries Postgres write once then succeeds", async () => {
    mockUpdateBudgetSpend
      .mockRejectedValueOnce(new Error("connection timeout"))
      .mockResolvedValueOnce(undefined);

    await reconcileReservation(mockRedis, "res-retry-ok", 25_000, entities, connString);

    expect(mockUpdateBudgetSpend).toHaveBeenCalledTimes(2);
    // Should NOT log the "failed after retries" error since it succeeded on retry
    expect(console.error).not.toHaveBeenCalledWith(
      "[budget-reconcile] Postgres write failed after retries",
      expect.anything(),
    );
  });

  it("emits structured error after all retries exhausted", async () => {
    mockUpdateBudgetSpend
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"));

    await reconcileReservation(mockRedis, "res-all-fail", 25_000, entities, connString);

    expect(mockUpdateBudgetSpend).toHaveBeenCalledTimes(3);
    expect(console.error).toHaveBeenCalledWith(
      "[budget-reconcile] Postgres write failed after retries",
      expect.objectContaining({
        reservationId: "res-all-fail",
        actualCostMicrodollars: 25_000,
        error: "timeout",
      }),
    );
    expect(console.error).toHaveBeenCalledWith(
      "[budget-reconcile] Redis/Postgres split-brain: reservation",
      "res-all-fail",
    );
  });

  it("retry delays are respected", async () => {
    vi.useFakeTimers();

    mockUpdateBudgetSpend
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"));

    const promise = reconcileReservation(mockRedis, "res-delay", 25_000, entities, connString);

    // After first failure, setTimeout(200) is scheduled
    await vi.advanceTimersByTimeAsync(200);
    // After second failure, setTimeout(800) is scheduled
    await vi.advanceTimersByTimeAsync(800);

    await promise;

    expect(mockUpdateBudgetSpend).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });
});
