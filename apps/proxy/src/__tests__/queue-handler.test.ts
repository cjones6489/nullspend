import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReconcileBudget } = vi.hoisted(() => ({
  mockReconcileBudget: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: vi.fn(),
}));

vi.mock("@upstash/redis/cloudflare", () => ({
  Redis: { fromEnv: vi.fn(() => ({})) },
}));

vi.mock("../lib/budget-orchestrator.js", () => ({
  reconcileBudget: (...args: unknown[]) => mockReconcileBudget(...args),
}));

import { handleReconciliationQueue } from "../queue-handler.js";

function makeEnv(): any {
  return {
    HYPERDRIVE: { connectionString: "postgresql://test:test@db:5432/test" },
    UPSTASH_REDIS_REST_URL: "https://fake.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "fake-token",
  };
}

function makeMessage(body: any): any {
  return {
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function makeBatch(messages: any[]): any {
  return { messages };
}

describe("handleReconciliationQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReconcileBudget.mockResolvedValue(undefined);
  });

  it("acks message on successful reconciliation", async () => {
    const msg = makeMessage({
      type: "reconcile",
      mode: "redis",
      reservationId: "res-123",
      actualCostMicrodollars: 50_000,
      budgetEntities: [
        { entityKey: "{budget}:api_key:key-1", entityType: "api_key", entityId: "key-1" },
      ],
      userId: "user-abc",
      enqueuedAt: Date.now(),
    });

    await handleReconciliationQueue(makeBatch([msg]), makeEnv());

    expect(mockReconcileBudget).toHaveBeenCalledTimes(1);
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("retries message on reconciliation failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockReconcileBudget.mockRejectedValueOnce(new Error("DB unavailable"));

    const msg = makeMessage({
      type: "reconcile",
      mode: "redis",
      reservationId: "res-fail",
      actualCostMicrodollars: 25_000,
      budgetEntities: [],
      userId: null,
      enqueuedAt: Date.now(),
    });

    await handleReconciliationQueue(makeBatch([msg]), makeEnv());

    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[queue] Reconciliation failed, retrying:",
      expect.any(Error),
    );
  });

  it("processes multiple messages in a batch", async () => {
    const msg1 = makeMessage({
      type: "reconcile",
      mode: "redis",
      reservationId: "res-1",
      actualCostMicrodollars: 10_000,
      budgetEntities: [],
      userId: "user-1",
      enqueuedAt: Date.now(),
    });
    const msg2 = makeMessage({
      type: "reconcile",
      mode: "redis",
      reservationId: "res-2",
      actualCostMicrodollars: 20_000,
      budgetEntities: [],
      userId: "user-2",
      enqueuedAt: Date.now(),
    });

    await handleReconciliationQueue(makeBatch([msg1, msg2]), makeEnv());

    expect(mockReconcileBudget).toHaveBeenCalledTimes(2);
    expect(msg1.ack).toHaveBeenCalledTimes(1);
    expect(msg2.ack).toHaveBeenCalledTimes(1);
  });

  it("passes correct arguments to reconcileBudget", async () => {
    const msg = makeMessage({
      type: "reconcile",
      mode: "durable-objects",
      reservationId: "res-args",
      actualCostMicrodollars: 75_000,
      budgetEntities: [
        { entityKey: "{budget}:user:u1", entityType: "user", entityId: "u1" },
      ],
      userId: "user-xyz",
      enqueuedAt: Date.now(),
    });

    const env = makeEnv();
    await handleReconciliationQueue(makeBatch([msg]), env);

    expect(mockReconcileBudget).toHaveBeenCalledWith(
      "durable-objects",
      env,
      "user-xyz",
      "res-args",
      75_000,
      expect.arrayContaining([
        expect.objectContaining({ entityType: "user", entityId: "u1" }),
      ]),
      env.HYPERDRIVE.connectionString,
      expect.anything(), // redis
    );
  });
});
