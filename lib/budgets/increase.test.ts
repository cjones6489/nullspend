import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { BudgetEntityNotFoundError } from "@/lib/actions/errors";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock @nullspend/db — must provide budgets column refs and the ACTION_*
// constants that @/lib/validations/actions imports via @/lib/utils/status.
vi.mock("@nullspend/db", () => ({
  budgets: {
    orgId: "budgets.orgId",
    entityType: "budgets.entityType",
    entityId: "budgets.entityId",
    maxBudgetMicrodollars: "budgets.maxBudgetMicrodollars",
  },
  ACTION_TYPES: [
    "send_email",
    "http_post",
    "http_delete",
    "shell_command",
    "db_write",
    "file_write",
    "file_delete",
    "budget_increase",
  ] as const,
  ACTION_STATUSES: [
    "pending",
    "approved",
    "rejected",
    "expired",
    "executing",
    "executed",
    "failed",
  ] as const,
}));

// Mock drizzle-orm helpers — the source code calls and/eq/sql but we only
// need them to not throw; the mock tx does the real work.
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((a: unknown, b: unknown) => [a, b]),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

// Mock feature-gate — resolveOrgTier and assertAmountBelowCap
const mockResolveOrgTier = vi.fn().mockResolvedValue({ tier: "free", label: "Free" });
const mockAssertAmountBelowCap = vi.fn();

vi.mock("@/lib/stripe/feature-gate", () => ({
  resolveOrgTier: (...args: unknown[]) => mockResolveOrgTier(...args),
  assertAmountBelowCap: (...args: unknown[]) => mockAssertAmountBelowCap(...args),
}));

// Mock observability — getLogger returns a stub
vi.mock("@/lib/observability", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import the function under test AFTER mocks are set up
import { executeBudgetIncrease } from "./increase";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeValidPayload(overrides: Record<string, unknown> = {}) {
  return {
    entityType: "api_key",
    entityId: "key-abc-123",
    requestedAmountMicrodollars: 5_000_000,
    currentLimitMicrodollars: 10_000_000,
    currentSpendMicrodollars: 2_000_000,
    reason: "Need more budget for production workloads",
    ...overrides,
  };
}

/**
 * Build a mock transaction object with the full chain:
 *   tx.select(...).from(...).where(...).limit(...).for(...) -> selectResult
 *   tx.update(...).set(...).where(...).returning(...)        -> updateResult
 */
function buildMockTx(
  selectResult: Record<string, unknown>[] | undefined,
  updateResult: Record<string, unknown>[] = [],
) {
  const mockFor = vi.fn().mockResolvedValue(selectResult ?? []);
  const mockLimit = vi.fn(() => ({ for: mockFor }));
  const mockSelectWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockSelectWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  const mockReturning = vi.fn().mockResolvedValue(updateResult);
  const mockUpdateWhere = vi.fn(() => ({ returning: mockReturning }));
  const mockSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));

  return {
    tx: { select: mockSelect, update: mockUpdate } as any,
    mockSelect,
    mockUpdate,
    mockReturning,
    mockFor,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeBudgetIncrease", () => {
  const ORG_ID = "org-test-123";

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveOrgTier.mockResolvedValue({ tier: "free", label: "Free" });
    mockAssertAmountBelowCap.mockImplementation(() => {});
  });

  it("happy path: increases budget and returns correct previousLimit/newLimit/amount", async () => {
    const payload = makeValidPayload();
    const previousLimit = 10_000_000;
    const newLimit = previousLimit + payload.requestedAmountMicrodollars; // 15_000_000

    const { tx } = buildMockTx(
      [{ maxBudgetMicrodollars: previousLimit }],
      [{ maxBudgetMicrodollars: newLimit }],
    );

    const result = await executeBudgetIncrease(tx, payload, ORG_ID);

    expect(result).toEqual({
      previousLimit: 10_000_000,
      newLimit: 15_000_000,
      amount: 5_000_000,
      requestedAmount: 5_000_000,
    });
    expect(mockResolveOrgTier).toHaveBeenCalledWith(ORG_ID);
    expect(mockAssertAmountBelowCap).toHaveBeenCalledWith(
      { tier: "free", label: "Free" },
      "spendCapMicrodollars",
      previousLimit + payload.requestedAmountMicrodollars,
    );
  });

  it("throws BudgetEntityNotFoundError when entity is not found on SELECT", async () => {
    const payload = makeValidPayload({ entityType: "agent", entityId: "agent-xyz" });
    // Return empty array from SELECT — entity not found
    const { tx } = buildMockTx([]);

    await expect(executeBudgetIncrease(tx, payload, ORG_ID)).rejects.toThrow(
      BudgetEntityNotFoundError,
    );
    await expect(executeBudgetIncrease(tx, payload, ORG_ID)).rejects.toThrow(
      /Budget entity not found: agent\/agent-xyz/,
    );
  });

  it("throws BudgetEntityNotFoundError when entity disappears between SELECT and UPDATE", async () => {
    const payload = makeValidPayload();
    // SELECT returns the entity, but UPDATE returns empty (concurrent delete)
    const { tx } = buildMockTx(
      [{ maxBudgetMicrodollars: 10_000_000 }],
      [], // empty UPDATE result
    );

    await expect(executeBudgetIncrease(tx, payload, ORG_ID)).rejects.toThrow(
      BudgetEntityNotFoundError,
    );
  });

  it("throws ZodError when payload is missing required fields", async () => {
    const invalidPayload = { entityType: "api_key" }; // missing most fields
    const { tx } = buildMockTx([{ maxBudgetMicrodollars: 10_000_000 }]);

    await expect(executeBudgetIncrease(tx, invalidPayload, ORG_ID)).rejects.toThrow(ZodError);
  });

  it("throws SpendCapExceededError when tier cap is exceeded", async () => {
    const payload = makeValidPayload({ requestedAmountMicrodollars: 100_000_000 });
    const previousLimit = 10_000_000;

    const { tx } = buildMockTx(
      [{ maxBudgetMicrodollars: previousLimit }],
      [{ maxBudgetMicrodollars: previousLimit + 100_000_000 }],
    );

    // Simulate assertAmountBelowCap throwing
    const capError = new Error(
      "Budget amount exceeds your Free tier spend cap of $100. Upgrade your plan to increase your limit.",
    );
    capError.name = "SpendCapExceededError";
    mockAssertAmountBelowCap.mockImplementation(() => {
      throw capError;
    });

    await expect(executeBudgetIncrease(tx, payload, ORG_ID)).rejects.toThrow(
      /spend cap/i,
    );
    expect(mockAssertAmountBelowCap).toHaveBeenCalledWith(
      { tier: "free", label: "Free" },
      "spendCapMicrodollars",
      previousLimit + 100_000_000,
    );
  });

  it("uses approvedAmountMicrodollars (partial approval) instead of requested amount", async () => {
    const payload = makeValidPayload({ requestedAmountMicrodollars: 10_000_000 });
    const previousLimit = 5_000_000;
    const partialAmount = 3_000_000;
    const newLimit = previousLimit + partialAmount; // 8_000_000

    const { tx } = buildMockTx(
      [{ maxBudgetMicrodollars: previousLimit }],
      [{ maxBudgetMicrodollars: newLimit }],
    );

    const result = await executeBudgetIncrease(tx, payload, ORG_ID, partialAmount);

    expect(result).toEqual({
      previousLimit: 5_000_000,
      newLimit: 8_000_000,
      amount: 3_000_000,
      requestedAmount: 10_000_000,
    });
    // Tier cap check should use the partial amount, not the requested amount
    expect(mockAssertAmountBelowCap).toHaveBeenCalledWith(
      { tier: "free", label: "Free" },
      "spendCapMicrodollars",
      previousLimit + partialAmount,
    );
  });

  it("throws when amount is zero", async () => {
    const payload = makeValidPayload({ requestedAmountMicrodollars: 1_000_000 });
    const { tx } = buildMockTx([{ maxBudgetMicrodollars: 10_000_000 }]);

    // Pass zero as approvedAmountMicrodollars to override the positive requestedAmount
    await expect(executeBudgetIncrease(tx, payload, ORG_ID, 0)).rejects.toThrow(
      "Budget increase amount must be positive",
    );
  });

  it("approvedAmount greater than requestedAmount works correctly", async () => {
    const payload = makeValidPayload({ requestedAmountMicrodollars: 2_000_000 });
    const previousLimit = 5_000_000;
    const biggerApproval = 10_000_000;
    const newLimit = previousLimit + biggerApproval;

    const { tx } = buildMockTx(
      [{ maxBudgetMicrodollars: previousLimit }],
      [{ maxBudgetMicrodollars: newLimit }],
    );

    const result = await executeBudgetIncrease(tx, payload, ORG_ID, biggerApproval);

    expect(result.amount).toBe(10_000_000);
    expect(result.requestedAmount).toBe(2_000_000);
    expect(result.previousLimit).toBe(5_000_000);
    expect(result.newLimit).toBe(15_000_000);
  });

  it("throws when amount is negative", async () => {
    const payload = makeValidPayload({ requestedAmountMicrodollars: 1_000_000 });
    const { tx } = buildMockTx([{ maxBudgetMicrodollars: 10_000_000 }]);

    // Pass negative as approvedAmountMicrodollars
    await expect(executeBudgetIncrease(tx, payload, ORG_ID, -500_000)).rejects.toThrow(
      "Budget increase amount must be positive",
    );
  });
});
