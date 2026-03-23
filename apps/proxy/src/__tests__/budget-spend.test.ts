/**
 * Budget Spend Unit Tests
 *
 * Tests updateBudgetSpend and resetBudgetPeriod with mocked Drizzle.
 * Validates defensive behavior: early returns on zero/negative cost or
 * empty entities, local dev bypass, transaction ordering, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockUpdateSet } = vi.hoisted(() => ({
  mockUpdateSet: vi.fn(),
}));

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdateChain = {
  set: mockUpdateSet.mockReturnValue({ where: mockUpdateWhere }),
};
const mockDrizzleDb = {
  update: vi.fn().mockReturnValue(mockUpdateChain),
  transaction: vi.fn(async (cb: (tx: any) => Promise<void>) => {
    await cb(mockDrizzleDb);
  }),
};

vi.mock("../lib/db.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../lib/db.js")>();
  return {
    ...orig,
    getDb: () => mockDrizzleDb,
  };
});

vi.mock("drizzle-orm", () => {
  const sqlTagFn = (..._args: unknown[]) => "sql-placeholder";
  return {
    sql: sqlTagFn,
    eq: vi.fn((_col: unknown, val: unknown) => val),
    and: vi.fn((...args: unknown[]) => args),
  };
});

vi.mock("@nullspend/db", () => ({
  budgets: {
    entityType: "entityType",
    entityId: "entityId",
    spendMicrodollars: "spendMicrodollars",
    currentPeriodStart: "currentPeriodStart",
    updatedAt: "updatedAt",
  },
}));

import { updateBudgetSpend, resetBudgetPeriod } from "../lib/budget-spend.js";

const REMOTE_CONN = "postgresql://postgres:postgres@db.example.com:5432/postgres";

describe("updateBudgetSpend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateWhere.mockResolvedValue(undefined);
  });

  it("early returns when actualCostMicrodollars is 0", async () => {
    await updateBudgetSpend(
      REMOTE_CONN,
      [{ entityType: "api_key", entityId: "key-1" }],
      0,
    );
    expect(mockDrizzleDb.update).not.toHaveBeenCalled();
  });

  it("early returns when actualCostMicrodollars is negative", async () => {
    await updateBudgetSpend(
      REMOTE_CONN,
      [{ entityType: "api_key", entityId: "key-1" }],
      -100,
    );
    expect(mockDrizzleDb.update).not.toHaveBeenCalled();
  });

  it("early returns when entities array is empty", async () => {
    await updateBudgetSpend(REMOTE_CONN, [], 500_000);
    expect(mockDrizzleDb.update).not.toHaveBeenCalled();
  });

  it("skips DB write when __SKIP_DB_PERSIST is set", async () => {
    (globalThis as Record<string, unknown>).__SKIP_DB_PERSIST = true;
    vi.spyOn(console, "log").mockImplementation(() => {});
    await updateBudgetSpend(
      "postgresql://postgres:postgres@localhost:5432/postgres",
      [{ entityType: "api_key", entityId: "key-1" }],
      500_000,
    );
    expect(mockDrizzleDb.update).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("[budget-spend]"),
      expect.anything(),
    );
    delete (globalThis as Record<string, unknown>).__SKIP_DB_PERSIST;
  });

  it("does NOT skip DB write when __SKIP_DB_PERSIST is unset (even for localhost)", async () => {
    await updateBudgetSpend(
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      [{ entityType: "user", entityId: "user-1" }],
      100_000,
    );
    expect(mockDrizzleDb.transaction).toHaveBeenCalled();
  });

  it("force persists when __FORCE_DB_PERSIST overrides __SKIP_DB_PERSIST", async () => {
    (globalThis as Record<string, unknown>).__SKIP_DB_PERSIST = true;
    (globalThis as Record<string, unknown>).__FORCE_DB_PERSIST = true;
    await updateBudgetSpend(
      "postgresql://postgres:postgres@abc123.hyperdrive.local:5432/postgres",
      [{ entityType: "api_key", entityId: "key-1" }],
      500_000,
    );
    expect(mockDrizzleDb.transaction).toHaveBeenCalled();
    delete (globalThis as Record<string, unknown>).__SKIP_DB_PERSIST;
    delete (globalThis as Record<string, unknown>).__FORCE_DB_PERSIST;
  });

  it("calls Drizzle update for each entity", async () => {
    await updateBudgetSpend(
      REMOTE_CONN,
      [
        { entityType: "api_key", entityId: "key-1" },
        { entityType: "user", entityId: "user-1" },
      ],
      500_000,
    );

    expect(mockDrizzleDb.update).toHaveBeenCalledTimes(2);
  });

  it("throws when Drizzle update fails (for retry by caller)", async () => {
    mockUpdateWhere.mockRejectedValueOnce(new Error("relation does not exist"));

    await expect(
      updateBudgetSpend(
        REMOTE_CONN,
        [{ entityType: "api_key", entityId: "key-1" }],
        500_000,
      ),
    ).rejects.toThrow("relation does not exist");
  });

  it("sorts entities by (entityType, entityId) before transaction", async () => {
    await updateBudgetSpend(
      REMOTE_CONN,
      [
        { entityType: "user", entityId: "user-1" },
        { entityType: "api_key", entityId: "key-2" },
        { entityType: "api_key", entityId: "key-1" },
      ],
      500_000,
    );

    expect(mockDrizzleDb.update).toHaveBeenCalledTimes(3);
    const whereCalls = mockUpdateWhere.mock.calls;
    expect(whereCalls[0][0]).toEqual(["api_key", "key-1"]);
    expect(whereCalls[1][0]).toEqual(["api_key", "key-2"]);
    expect(whereCalls[2][0]).toEqual(["user", "user-1"]);
  });
});

describe("resetBudgetPeriod", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateWhere.mockResolvedValue(undefined);
  });

  it("early returns on empty array", async () => {
    await resetBudgetPeriod(REMOTE_CONN, []);
    expect(mockDrizzleDb.update).not.toHaveBeenCalled();
  });

  it("sets spend=0 and currentPeriodStart for each entity", async () => {
    await resetBudgetPeriod(REMOTE_CONN, [
      { entityType: "user", entityId: "user-1", newPeriodStart: 1_710_000_000_000 },
      { entityType: "api_key", entityId: "key-1", newPeriodStart: 1_710_000_000_000 },
    ]);

    expect(mockDrizzleDb.update).toHaveBeenCalledTimes(2);
  });

  it("never throws on Postgres error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockDrizzleDb.transaction.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(
      resetBudgetPeriod(REMOTE_CONN, [
        { entityType: "user", entityId: "user-1", newPeriodStart: 1_710_000_000_000 },
      ]),
    ).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[budget-spend]"),
      expect.any(String),
    );

    // Restore transaction mock for subsequent tests
    mockDrizzleDb.transaction.mockImplementation(async (cb: (tx: any) => Promise<void>) => {
      await cb(mockDrizzleDb);
    });
  });

  it("skips on local connection", async () => {
    (globalThis as Record<string, unknown>).__SKIP_DB_PERSIST = true;
    vi.spyOn(console, "log").mockImplementation(() => {});

    await resetBudgetPeriod(
      "postgresql://postgres:postgres@localhost:5432/postgres",
      [{ entityType: "user", entityId: "user-1", newPeriodStart: 1_710_000_000_000 }],
    );

    expect(mockDrizzleDb.update).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("[budget-spend]"),
      expect.anything(),
    );

    delete (globalThis as Record<string, unknown>).__SKIP_DB_PERSIST;
  });

  it("handles multiple resets in single call", async () => {
    await resetBudgetPeriod(REMOTE_CONN, [
      { entityType: "user", entityId: "user-1", newPeriodStart: 1_710_000_000_000 },
      { entityType: "api_key", entityId: "key-1", newPeriodStart: 1_710_000_000_000 },
      { entityType: "user", entityId: "user-2", newPeriodStart: 1_710_000_000_000 },
    ]);

    expect(mockDrizzleDb.update).toHaveBeenCalledTimes(3);
  });

  it("sorts entities before transaction to prevent deadlocks", async () => {
    await resetBudgetPeriod(REMOTE_CONN, [
      { entityType: "user", entityId: "user-1", newPeriodStart: 1_710_000_000_000 },
      { entityType: "api_key", entityId: "key-1", newPeriodStart: 1_710_000_000_000 },
    ]);

    expect(mockDrizzleDb.update).toHaveBeenCalledTimes(2);
    const whereCalls = mockUpdateWhere.mock.calls;
    expect(whereCalls[0][0]).toEqual(["api_key", "key-1"]);
    expect(whereCalls[1][0]).toEqual(["user", "user-1"]);
  });
});
