import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  });

  it("increments spend for matching api_key budget", async () => {
    const budgetRow = makeBudgetRow();
    const updatedRow = { id: "budget-1", spendMicrodollars: 5_010_000 };

    const mockReturning = vi.fn().mockResolvedValue([updatedRow]);
    const mockWhere = vi.fn(() => ({ returning: mockReturning }));
    const mockSet = vi.fn(() => ({ where: mockWhere }));
    const mockUpdate = vi.fn(() => ({ set: mockSet }));

    const mockTx = { update: mockUpdate };

    const mockSelectWhere = vi.fn().mockResolvedValue([budgetRow]);
    const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
    const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

    mockedGetDb.mockReturnValue({
      select: mockSelect,
      transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockTx)),
    } as unknown as ReturnType<typeof getDb>);

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

  it("does not update budgets for non-matching key", async () => {
    const budgetRow = makeBudgetRow({ entityId: "key-other" });

    const mockSelectWhere = vi.fn().mockResolvedValue([budgetRow]);
    const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
    const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

    mockedGetDb.mockReturnValue({
      select: mockSelect,
      transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb({})),
    } as unknown as ReturnType<typeof getDb>);

    const result = await updateBudgetSpendFromCostEvent("org-1", "key-1", 10_000);
    expect(result.updatedEntities).toHaveLength(0);
  });

  it("matches tag budgets by key=value format", async () => {
    const tagBudget = makeBudgetRow({
      id: "budget-tag-1",
      entityType: "tag",
      entityId: "project=alpha",
    });
    const updatedRow = { id: "budget-tag-1", spendMicrodollars: 5_010_000 };

    const mockReturning = vi.fn().mockResolvedValue([updatedRow]);
    const mockWhere = vi.fn(() => ({ returning: mockReturning }));
    const mockSet = vi.fn(() => ({ where: mockWhere }));
    const mockUpdate = vi.fn(() => ({ set: mockSet }));
    const mockTx = { update: mockUpdate };

    const mockSelectWhere = vi.fn().mockResolvedValue([tagBudget]);
    const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
    const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

    mockedGetDb.mockReturnValue({
      select: mockSelect,
      transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockTx)),
    } as unknown as ReturnType<typeof getDb>);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", "key-1", 10_000, { project: "alpha" },
    );

    expect(result.updatedEntities).toHaveLength(1);
    expect(result.updatedEntities[0].entityType).toBe("tag");
    expect(result.updatedEntities[0].entityId).toBe("project=alpha");
  });

  it("does not match tag budget when tag value differs", async () => {
    const tagBudget = makeBudgetRow({
      entityType: "tag",
      entityId: "project=alpha",
    });

    const mockSelectWhere = vi.fn().mockResolvedValue([tagBudget]);
    const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
    const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

    mockedGetDb.mockReturnValue({
      select: mockSelect,
      transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb({})),
    } as unknown as ReturnType<typeof getDb>);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", "key-1", 10_000, { project: "beta" },
    );
    expect(result.updatedEntities).toHaveLength(0);
  });

  it("updates multiple matching budgets in sorted order", async () => {
    const budgets = [
      makeBudgetRow({ id: "b-key", entityType: "api_key", entityId: "key-1" }),
      makeBudgetRow({ id: "b-tag", entityType: "tag", entityId: "env=prod" }),
    ];

    const updateCalls: string[] = [];
    const mockReturning = vi.fn().mockImplementation(() => {
      const id = updateCalls[updateCalls.length - 1];
      return [{ id, spendMicrodollars: 5_010_000 }];
    });
    const mockWhere = vi.fn(() => ({ returning: mockReturning }));
    const mockSet = vi.fn(() => ({ where: mockWhere }));
    const mockUpdate = vi.fn().mockImplementation(() => {
      return { set: mockSet };
    });
    const mockTx = { update: mockUpdate };

    const mockSelectWhere = vi.fn().mockResolvedValue(budgets);
    const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
    const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

    mockedGetDb.mockReturnValue({
      select: mockSelect,
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        // Track update order via mockSet calls
        mockSet.mockImplementation(() => {
          return { where: mockWhere };
        });
        return cb(mockTx);
      }),
    } as unknown as ReturnType<typeof getDb>);

    const result = await updateBudgetSpendFromCostEvent(
      "org-1", "key-1", 10_000, { env: "prod" },
    );

    // Both budgets should be updated
    expect(result.updatedEntities).toHaveLength(2);
    // api_key sorts before tag alphabetically
    expect(result.updatedEntities[0].entityType).toBe("api_key");
    expect(result.updatedEntities[1].entityType).toBe("tag");
  });

  it("returns empty when no budgets exist for org", async () => {
    const mockSelectWhere = vi.fn().mockResolvedValue([]);
    const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
    const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

    mockedGetDb.mockReturnValue({
      select: mockSelect,
    } as unknown as ReturnType<typeof getDb>);

    const result = await updateBudgetSpendFromCostEvent("org-1", "key-1", 10_000);
    expect(result.updatedEntities).toHaveLength(0);
  });
});
