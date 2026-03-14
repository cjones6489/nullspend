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
  // When Redis cache expires, budget will be rebuilt from stale Postgres data,
  // effectively "forgetting" this spend.
  it("partial failure: Redis succeeds but Postgres fails", async () => {
    mockReconcile.mockResolvedValue({ status: "reconciled", spends: {} });
    mockUpdateBudgetSpend.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      reconcileReservation(mockRedis, "res-pg-fail", 30_000, entities, connString),
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      "[budget] Reconciliation failed:",
      expect.any(Error),
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
});
