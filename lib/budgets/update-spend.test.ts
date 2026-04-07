import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/lib/db/client";
import { updateBudgetSpendFromCostEvent } from "./update-spend";

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(),
}));

const mockedGetDb = vi.mocked(getDb);

function makeBudgetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "budget-1",
    entityType: "api_key",
    entityId: "key-1",
    spendMicrodollars: 5_000_000,
    maxBudgetMicrodollars: 20_000_000,
    thresholdPercentages: [50, 80, 90, 95],
    ...overrides,
  };
}

/**
 * Build a minimal mock DB that supports:
 *   select().from().where()  -> returns `rows`
 *   transaction(cb)          -> calls `cb(tx)`
 *   tx.update().set().where().returning() -> returns `updatedRows` (per-call via queue)
 */
function buildMockDb(
  rows: ReturnType<typeof makeBudgetRow>[],
  updatedRowsQueue: { id: string; spendMicrodollars: number }[][] = [],
) {
  let updateCallIndex = 0;

  const mockReturning = vi.fn().mockImplementation(() => {
    const result = updatedRowsQueue[updateCallIndex] ?? [];
    updateCallIndex++;
    return result;
  });
  const mockUpdateWhere = vi.fn(() => ({ returning: mockReturning }));
  const mockSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));
  const mockTx = { update: mockUpdate };

  const mockSelectWhere = vi.fn().mockResolvedValue(rows);
  const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
  const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

  const db = {
    select: mockSelect,
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockTx)),
  } as unknown as ReturnType<typeof getDb>;

  return { db, mockUpdate, mockSet, mockUpdateWhere, mockReturning, mockTx };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("updateBudgetSpendFromCostEvent", () => {
  it("returns empty when costMicrodollars is zero", async () => {
    const result = await updateBudgetSpendFromCostEvent("org-1", "key-1", 0);
    expect(result.updatedEntities).toEqual([]);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("returns empty when costMicrodollars is negative", async () => {
    const result = await updateBudgetSpendFromCostEvent("org-1", "key-1", -100);
    expect(result.updatedEntities).toEqual([]);
    expect(mockedGetDb).not.toHaveBeenCalled();
  });

  it("increments spend for matching api_key budget", async () => {
    const budgetRow = makeBudgetRow();
    const { db } = buildMockDb(
      [budgetRow],
      [[{ id: "budget-1", spendMicrodollars: 5_010_000 }]],
    );
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent("org-1", "key-1", 10_000);

    expect(result.updatedEntities).toHaveLength(1);
    expect(result.updatedEntities[0]).toEqual({
      id: "budget-1",
      entityType: "api_key",
      entityId: "key-1",
      previousSpend: 5_000_000,
      newSpend: 5_010_000,
      maxBudget: 20_000_000,
      thresholdPercentages: [50, 80, 90, 95],
    });
  });

  it("increments spend for matching tag budget entity (entityId format key=value)", async () => {
    const tagBudget = makeBudgetRow({
      id: "budget-tag-1",
      entityType: "tag",
      entityId: "project=alpha",
    });
    const { db } = buildMockDb(
      [tagBudget],
      [[{ id: "budget-tag-1", spendMicrodollars: 5_010_000 }]],
    );
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", "key-1", 10_000, { project: "alpha" },
    );

    expect(result.updatedEntities).toHaveLength(1);
    expect(result.updatedEntities[0].entityType).toBe("tag");
    expect(result.updatedEntities[0].entityId).toBe("project=alpha");
  });

  it("returns previous and new spend for threshold detection", async () => {
    const budgetRow = makeBudgetRow({
      spendMicrodollars: 15_000_000,
      maxBudgetMicrodollars: 20_000_000,
    });
    const { db } = buildMockDb(
      [budgetRow],
      [[{ id: "budget-1", spendMicrodollars: 15_500_000 }]],
    );
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent("org-1", "key-1", 500_000);

    expect(result.updatedEntities).toHaveLength(1);
    expect(result.updatedEntities[0].previousSpend).toBe(15_000_000);
    expect(result.updatedEntities[0].newSpend).toBe(15_500_000);
    expect(result.updatedEntities[0].maxBudget).toBe(20_000_000);
    expect(result.updatedEntities[0].thresholdPercentages).toEqual([50, 80, 90, 95]);
  });

  it("returns empty when no budgets exist for org", async () => {
    const { db } = buildMockDb([]);
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent("org-1", "key-1", 10_000);
    expect(result.updatedEntities).toHaveLength(0);
  });

  it("returns empty when no matching budgets (key mismatch)", async () => {
    const budgetRow = makeBudgetRow({ entityId: "key-other" });
    const { db } = buildMockDb([budgetRow]);
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent("org-1", "key-1", 10_000);
    expect(result.updatedEntities).toHaveLength(0);
  });

  it("updates multiple matching entities (api_key + tag)", async () => {
    const rows = [
      makeBudgetRow({ id: "b-key", entityType: "api_key", entityId: "key-1" }),
      makeBudgetRow({ id: "b-tag", entityType: "tag", entityId: "env=prod" }),
    ];
    const { db } = buildMockDb(rows, [
      [{ id: "b-key", spendMicrodollars: 5_010_000 }],
      [{ id: "b-tag", spendMicrodollars: 5_010_000 }],
    ]);
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", "key-1", 10_000, { env: "prod" },
    );

    expect(result.updatedEntities).toHaveLength(2);
    // api_key sorts before tag alphabetically
    expect(result.updatedEntities[0].entityType).toBe("api_key");
    expect(result.updatedEntities[1].entityType).toBe("tag");
  });

  it("sorts entities by (entityType, entityId) before transaction to prevent deadlocks", async () => {
    // Intentionally reversed: tag first, api_key second in DB results
    const rows = [
      makeBudgetRow({ id: "b-tag-z", entityType: "tag", entityId: "z=val" }),
      makeBudgetRow({ id: "b-tag-a", entityType: "tag", entityId: "a=val" }),
      makeBudgetRow({ id: "b-key", entityType: "api_key", entityId: "key-1" }),
    ];
    const updatedIds: string[] = [];
    const mockReturning = vi.fn().mockImplementation(() => {
      return [{ id: updatedIds[updatedIds.length - 1], spendMicrodollars: 5_010_000 }];
    });
    const mockUpdateWhere = vi.fn(() => ({ returning: mockReturning }));
    const mockSet = vi.fn().mockImplementation(() => ({ where: mockUpdateWhere }));
    const mockUpdate = vi.fn().mockImplementation(() => {
      // We track order by inspecting result entity order
      return { set: mockSet };
    });
    const mockTx = { update: mockUpdate };

    const mockSelectWhere = vi.fn().mockResolvedValue(rows);
    const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
    const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

    mockedGetDb.mockReturnValue({
      select: mockSelect,
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockTx)),
    } as unknown as ReturnType<typeof getDb>);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", "key-1", 10_000, { a: "val", z: "val" },
    );

    expect(result.updatedEntities).toHaveLength(3);
    // Sorted: api_key < tag, then a < z
    expect(result.updatedEntities[0].entityType).toBe("api_key");
    expect(result.updatedEntities[1].entityId).toBe("a=val");
    expect(result.updatedEntities[2].entityId).toBe("z=val");
  });

  it("does not update non-matching entity types (agent, team)", async () => {
    const rows = [
      makeBudgetRow({ id: "b-agent", entityType: "agent", entityId: "agent-1" }),
      makeBudgetRow({ id: "b-team", entityType: "team", entityId: "team-1" }),
    ];
    const { db } = buildMockDb(rows);
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent("org-1", "key-1", 10_000);
    expect(result.updatedEntities).toHaveLength(0);
  });

  it("increments spend for matching user budget when userId provided", async () => {
    const userBudget = makeBudgetRow({
      id: "budget-user-1",
      entityType: "user",
      entityId: "user-1",
    });
    const { db } = buildMockDb(
      [userBudget],
      [[{ id: "budget-user-1", spendMicrodollars: 5_010_000 }]],
    );
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", "key-1", 10_000, undefined, "user-1",
    );

    expect(result.updatedEntities).toHaveLength(1);
    expect(result.updatedEntities[0].entityType).toBe("user");
    expect(result.updatedEntities[0].entityId).toBe("user-1");
  });

  it("does not match user budget when userId is not provided", async () => {
    const userBudget = makeBudgetRow({
      id: "budget-user-1",
      entityType: "user",
      entityId: "user-1",
    });
    const { db } = buildMockDb([userBudget]);
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent("org-1", "key-1", 10_000);
    expect(result.updatedEntities).toHaveLength(0);
  });

  it("does not match user budget when userId differs", async () => {
    const userBudget = makeBudgetRow({
      id: "budget-user-1",
      entityType: "user",
      entityId: "user-1",
    });
    const { db } = buildMockDb([userBudget]);
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", "key-1", 10_000, undefined, "user-other",
    );
    expect(result.updatedEntities).toHaveLength(0);
  });

  it("does not update tag budget when tag value differs", async () => {
    const tagBudget = makeBudgetRow({
      entityType: "tag",
      entityId: "project=alpha",
    });
    const { db } = buildMockDb([tagBudget]);
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", "key-1", 10_000, { project: "beta" },
    );
    expect(result.updatedEntities).toHaveLength(0);
  });

  it("does not match tag budget when tags are not provided", async () => {
    const tagBudget = makeBudgetRow({
      entityType: "tag",
      entityId: "project=alpha",
    });
    const { db } = buildMockDb([tagBudget]);
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent("org-1", "key-1", 10_000);
    expect(result.updatedEntities).toHaveLength(0);
  });

  it("does not match api_key budgets when apiKeyId is null", async () => {
    const keyBudget = makeBudgetRow({
      entityType: "api_key",
      entityId: "key-1",
    });
    const { db } = buildMockDb([keyBudget]);
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent("org-1", null, 10_000);
    expect(result.updatedEntities).toHaveLength(0);
  });

  it("does not match tag budget when entityId has no = separator", async () => {
    const tagBudget = makeBudgetRow({
      entityType: "tag",
      entityId: "malformed-no-equals",
    });
    const { db } = buildMockDb([tagBudget]);
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", "key-1", 10_000, { malformed: "val" },
    );
    expect(result.updatedEntities).toHaveLength(0);
  });

  it("matches tag budget with value containing = character", async () => {
    // Tag entityId: "config=key=value" → tagKey="config", tagValue="key=value"
    const tagBudget = makeBudgetRow({
      id: "budget-eq",
      entityType: "tag",
      entityId: "config=key=value",
    });
    const { db } = buildMockDb(
      [tagBudget],
      [[{ id: "budget-eq", spendMicrodollars: 5_010_000 }]],
    );
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", "key-1", 10_000, { config: "key=value" },
    );
    expect(result.updatedEntities).toHaveLength(1);
    expect(result.updatedEntities[0].entityId).toBe("config=key=value");
  });

  it("previousSpend and newSpend are always integers (microdollars)", async () => {
    const budgetRow = makeBudgetRow({ spendMicrodollars: 1_234_567 });
    const { db } = buildMockDb(
      [budgetRow],
      [[{ id: "budget-1", spendMicrodollars: 1_244_567 }]],
    );
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent("org-1", "key-1", 10_000);

    expect(Number.isInteger(result.updatedEntities[0].previousSpend)).toBe(true);
    expect(Number.isInteger(result.updatedEntities[0].newSpend)).toBe(true);
    expect(result.updatedEntities[0].newSpend - result.updatedEntities[0].previousSpend).toBe(10_000);
  });

  it("handles 1 microdollar cost (smallest possible)", async () => {
    const budgetRow = makeBudgetRow({ spendMicrodollars: 0 });
    const { db } = buildMockDb(
      [budgetRow],
      [[{ id: "budget-1", spendMicrodollars: 1 }]],
    );
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent("org-1", "key-1", 1);
    expect(result.updatedEntities).toHaveLength(1);
    expect(result.updatedEntities[0].previousSpend).toBe(0);
    expect(result.updatedEntities[0].newSpend).toBe(1);
  });

  it("increments spend for matching customer budget entity", async () => {
    const { db } = buildMockDb(
      [makeBudgetRow({ entityType: "customer", entityId: "acme-corp" })],
      [[{ id: "budget-1", spendMicrodollars: 5_001_000 }]],
    );
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", null, 1000, undefined, undefined, "acme-corp",
    );
    expect(result.updatedEntities).toHaveLength(1);
    expect(result.updatedEntities[0].entityType).toBe("customer");
    expect(result.updatedEntities[0].entityId).toBe("acme-corp");
  });

  it("does not match customer budget when customerId is null", async () => {
    const { db } = buildMockDb(
      [makeBudgetRow({ entityType: "customer", entityId: "acme-corp" })],
    );
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", null, 1000, undefined, undefined, null,
    );
    expect(result.updatedEntities).toHaveLength(0);
  });

  it("does not match customer budget when customerId differs", async () => {
    const { db } = buildMockDb(
      [makeBudgetRow({ entityType: "customer", entityId: "acme-corp" })],
    );
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", null, 1000, undefined, undefined, "other-corp",
    );
    expect(result.updatedEntities).toHaveLength(0);
  });

  it("matches both customer and tag budgets for same customer", async () => {
    const { db } = buildMockDb(
      [
        makeBudgetRow({ id: "b1", entityType: "customer", entityId: "acme-corp" }),
        makeBudgetRow({ id: "b2", entityType: "tag", entityId: "customer=acme-corp" }),
      ],
      [
        [{ id: "b1", spendMicrodollars: 5_001_000 }],
        [{ id: "b2", spendMicrodollars: 5_001_000 }],
      ],
    );
    mockedGetDb.mockReturnValue(db);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", null, 1000, { customer: "acme-corp" }, undefined, "acme-corp",
    );
    expect(result.updatedEntities).toHaveLength(2);
  });
});
