/**
 * Budget Spend Unit Tests
 *
 * Tests updateBudgetSpend and resetBudgetPeriod with mocked postgres.js.
 * Validates defensive behavior: early returns on zero/negative cost or
 * empty entities, local dev bypass, transaction ordering, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTx = vi.fn().mockResolvedValue([]);
const mockBegin = vi.fn(async (cb: (tx: any) => Promise<void>) => {
  await cb(mockTx);
});
const mockSql = Object.assign(vi.fn().mockResolvedValue([]), { begin: mockBegin });

vi.mock("../lib/db.js", () => ({
  getSql: () => mockSql,
}));

import { updateBudgetSpend, resetBudgetPeriod } from "../lib/budget-spend.js";

const REMOTE_CONN = "postgresql://postgres:postgres@db.example.com:5432/postgres";

describe("updateBudgetSpend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.mockResolvedValue([]);
  });

  it("early returns when actualCostMicrodollars is 0", async () => {
    await updateBudgetSpend(REMOTE_CONN, "org-test", [{ entityType: "api_key", entityId: "key-1" }], 0);
    expect(mockBegin).not.toHaveBeenCalled();
  });

  it("early returns when actualCostMicrodollars is negative", async () => {
    await updateBudgetSpend(REMOTE_CONN, "org-test", [{ entityType: "api_key", entityId: "key-1" }], -100);
    expect(mockBegin).not.toHaveBeenCalled();
  });

  it("early returns when entities array is empty", async () => {
    await updateBudgetSpend(REMOTE_CONN, "org-test", [], 500_000);
    expect(mockBegin).not.toHaveBeenCalled();
  });

  it("skips DB write when skipDbWrites is true", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await updateBudgetSpend(REMOTE_CONN, "org-test", [{ entityType: "api_key", entityId: "key-1" }], 500_000, true);
    expect(mockBegin).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("[budget-spend]"), expect.anything());
  });

  it("writes to DB by default (skipDbWrites defaults to false)", async () => {
    await updateBudgetSpend(REMOTE_CONN, "org-test", [{ entityType: "user", entityId: "user-1" }], 100_000);
    expect(mockBegin).toHaveBeenCalledOnce();
  });

  it("calls tx for each entity inside transaction", async () => {
    await updateBudgetSpend(
      REMOTE_CONN,
      "org-test",
      [{ entityType: "api_key", entityId: "key-1" }, { entityType: "user", entityId: "user-1" }],
      500_000,
    );

    expect(mockBegin).toHaveBeenCalledOnce();
    expect(mockTx).toHaveBeenCalledTimes(2);
  });

  it("sorts entities by (entityType, entityId) before transaction", async () => {
    await updateBudgetSpend(
      REMOTE_CONN,
      "org-test",
      [
        { entityType: "user", entityId: "user-1" },
        { entityType: "api_key", entityId: "key-2" },
        { entityType: "api_key", entityId: "key-1" },
      ],
      500_000,
    );

    expect(mockTx).toHaveBeenCalledTimes(3);
    // Tagged template calls: check parameter order
    // First call should be api_key:key-1, second api_key:key-2, third user:user-1
    const calls = mockTx.mock.calls;
    expect(calls[0][1]).toBe(500_000); // cost
    expect(calls[0][2]).toBe("api_key"); // entity_type
    expect(calls[0][3]).toBe("key-1"); // entity_id
    expect(calls[1][2]).toBe("api_key");
    expect(calls[1][3]).toBe("key-2");
    expect(calls[2][2]).toBe("user");
    expect(calls[2][3]).toBe("user-1");
  });

  it("throws when transaction fails (for retry by caller)", async () => {
    mockBegin.mockRejectedValueOnce(new Error("connection failed"));

    await expect(
      updateBudgetSpend(REMOTE_CONN, "org-test", [{ entityType: "api_key", entityId: "key-1" }], 500_000),
    ).rejects.toThrow("connection failed");
  });

  // Regression: Codex audit P0 #1 — cross-tenant budget corruption.
  // The UPDATE WHERE clause MUST include org_id so two orgs with the same
  // customer entity don't increment each other's budgets.
  it("passes orgId as SQL parameter for tenant isolation", async () => {
    await updateBudgetSpend(
      REMOTE_CONN,
      "org-alpha",
      [{ entityType: "customer", entityId: "acme-corp" }],
      100_000,
    );

    expect(mockTx).toHaveBeenCalledTimes(1);
    const call = mockTx.mock.calls[0];
    // Tagged template params: [1]=cost, [2]=entityType, [3]=entityId, [4]=orgId
    expect(call[1]).toBe(100_000);
    expect(call[2]).toBe("customer");
    expect(call[3]).toBe("acme-corp");
    expect(call[4]).toBe("org-alpha");
  });

  it("different orgIds produce different SQL parameters (cross-tenant isolation)", async () => {
    await updateBudgetSpend(REMOTE_CONN, "org-alpha", [{ entityType: "customer", entityId: "acme-corp" }], 50_000);
    await updateBudgetSpend(REMOTE_CONN, "org-beta", [{ entityType: "customer", entityId: "acme-corp" }], 75_000);

    expect(mockTx).toHaveBeenCalledTimes(2);
    // Same entity name, different orgIds — must produce different SQL params
    expect(mockTx.mock.calls[0][4]).toBe("org-alpha");
    expect(mockTx.mock.calls[1][4]).toBe("org-beta");
  });
});

describe("resetBudgetPeriod", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.mockResolvedValue([]);
    mockBegin.mockImplementation(async (cb: (tx: any) => Promise<void>) => {
      await cb(mockTx);
    });
  });

  it("early returns on empty array", async () => {
    await resetBudgetPeriod(REMOTE_CONN, "org-test", []);
    expect(mockBegin).not.toHaveBeenCalled();
  });

  it("calls tx for each reset inside transaction", async () => {
    await resetBudgetPeriod(REMOTE_CONN, "org-test", [
      { entityType: "user", entityId: "user-1", newPeriodStart: 1_710_000_000_000 },
      { entityType: "api_key", entityId: "key-1", newPeriodStart: 1_710_000_000_000 },
    ]);

    expect(mockBegin).toHaveBeenCalledOnce();
    expect(mockTx).toHaveBeenCalledTimes(2);
  });

  it("never throws on Postgres error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockBegin.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(
      resetBudgetPeriod(REMOTE_CONN, "org-test", [
        { entityType: "user", entityId: "user-1", newPeriodStart: 1_710_000_000_000 },
      ]),
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[budget-spend]"),
      expect.any(String),
    );
  });

  it("skips when skipDbWrites is true", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await resetBudgetPeriod(REMOTE_CONN, "org-test", [
      { entityType: "user", entityId: "user-1", newPeriodStart: 1_710_000_000_000 },
    ], true);

    expect(mockBegin).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("[budget-spend]"), expect.anything());
  });

  it("sorts entities before transaction to prevent deadlocks", async () => {
    await resetBudgetPeriod(REMOTE_CONN, "org-test", [
      { entityType: "user", entityId: "user-1", newPeriodStart: 1_710_000_000_000 },
      { entityType: "api_key", entityId: "key-1", newPeriodStart: 1_710_000_000_000 },
    ]);

    expect(mockTx).toHaveBeenCalledTimes(2);
    const calls = mockTx.mock.calls;
    // First call: api_key:key-1 (sorted)
    expect(calls[0][2]).toBe("api_key");
    expect(calls[0][3]).toBe("key-1");
    // Second call: user:user-1
    expect(calls[1][2]).toBe("user");
    expect(calls[1][3]).toBe("user-1");
  });

  // Regression: Codex P0 #1 — orgId must appear in resetBudgetPeriod SQL
  it("passes orgId as SQL parameter for tenant isolation", async () => {
    await resetBudgetPeriod(REMOTE_CONN, "org-gamma", [
      { entityType: "tag", entityId: "team=eng", newPeriodStart: 1_710_000_000_000 },
    ]);

    expect(mockTx).toHaveBeenCalledTimes(1);
    const call = mockTx.mock.calls[0];
    // Tagged template params: [1]=periodStart, [2]=entityType, [3]=entityId, [4]=orgId
    expect(call[2]).toBe("tag");
    expect(call[3]).toBe("team=eng");
    expect(call[4]).toBe("org-gamma");
  });
});
