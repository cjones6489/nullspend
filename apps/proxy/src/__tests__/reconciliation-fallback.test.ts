import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEnqueueReconciliation } = vi.hoisted(() => ({
  mockEnqueueReconciliation: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: vi.fn(),
}));

vi.mock("@upstash/redis/cloudflare", () => ({
  Redis: { fromEnv: vi.fn(() => ({})) },
}));

vi.mock("../lib/budget-reconcile.js", () => ({
  reconcileReservation: vi.fn(),
}));

vi.mock("../lib/budget.js", () => ({
  checkAndReserve: vi.fn(),
}));

vi.mock("../lib/budget-lookup.js", () => ({
  lookupBudgets: vi.fn(),
}));

vi.mock("../lib/budget-do-lookup.js", () => ({
  lookupBudgetsForDO: vi.fn(),
}));

vi.mock("../lib/budget-do-client.js", () => ({
  doBudgetCheck: vi.fn(),
  doBudgetReconcile: vi.fn(),
  doBudgetPopulate: vi.fn(),
}));

vi.mock("../lib/budget-spend.js", () => ({
  resetBudgetPeriod: vi.fn(),
}));

vi.mock("../lib/reconciliation-queue.js", () => ({
  enqueueReconciliation: (...args: unknown[]) => mockEnqueueReconciliation(...args),
}));

// We need to mock reconcileBudget but import reconcileBudgetQueued
// Since reconcileBudgetQueued calls reconcileBudget internally, we need a different approach
// Let's use the actual module but mock the internal dependencies

import { reconcileBudgetQueued } from "../lib/budget-orchestrator.js";

function makeEnv(): any {
  return {
    HYPERDRIVE: { connectionString: "postgresql://test:test@db:5432/test" },
    BUDGET_ENGINE: "redis",
  };
}

const mockRedis = {} as any;

const budgetEntities = [
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

describe("reconcileBudgetQueued", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueueReconciliation.mockResolvedValue(undefined);
  });

  it("uses queue when available", async () => {
    const mockQueue = {} as any;

    await reconcileBudgetQueued(
      mockQueue, "redis", makeEnv(), "user-1", "res-123", 50_000,
      budgetEntities, "postgresql://test", mockRedis,
    );

    expect(mockEnqueueReconciliation).toHaveBeenCalledWith(
      mockQueue,
      expect.objectContaining({
        type: "reconcile",
        mode: "redis",
        reservationId: "res-123",
        actualCostMicrodollars: 50_000,
        userId: "user-1",
      }),
    );
  });

  it("falls back to direct reconciliation when queue is undefined", async () => {
    // When queue is undefined, reconcileBudgetQueued should call reconcileBudget directly
    // (which calls reconcileReservation for redis mode)
    await reconcileBudgetQueued(
      undefined, "redis", makeEnv(), "user-1", "res-456", 25_000,
      budgetEntities, "postgresql://test", mockRedis,
    );

    // Queue was not called
    expect(mockEnqueueReconciliation).not.toHaveBeenCalled();
  });

  it("falls back to direct when queue send fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const mockQueue = {} as any;
    mockEnqueueReconciliation.mockRejectedValueOnce(new Error("queue unavailable"));

    await reconcileBudgetQueued(
      mockQueue, "redis", makeEnv(), "user-1", "res-789", 30_000,
      budgetEntities, "postgresql://test", mockRedis,
    );

    expect(mockEnqueueReconciliation).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "[budget-orchestrator] Queue send failed, falling back to direct:",
      expect.any(Error),
    );
  });

  it("skips queue when reservationId is null", async () => {
    const mockQueue = {} as any;

    await reconcileBudgetQueued(
      mockQueue, "redis", makeEnv(), "user-1", null, 0,
      [], "postgresql://test", mockRedis,
    );

    // No queue or direct reconciliation for null reservationId
    expect(mockEnqueueReconciliation).not.toHaveBeenCalled();
  });
});
