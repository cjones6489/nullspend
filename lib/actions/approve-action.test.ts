import { describe, it, expect, vi, beforeEach } from "vitest";

import { approveAction } from "@/lib/actions/approve-action";
import {
  ActionExpiredError,
  ActionNotFoundError,
  StaleActionError,
  InvalidActionTransitionError,
} from "@/lib/actions/errors";
import { executeBudgetIncrease } from "@/lib/budgets/increase";

const mockExecuteBudgetIncrease = vi.mocked(executeBudgetIncrease);

// Mock getDb to return a fake transaction runner
const mockTxSelect = vi.fn();
const mockTxUpdate = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => ({
                for: mockTxSelect,
              }),
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              returning: mockTxUpdate,
            }),
          }),
        }),
      };
      return fn(tx);
    }),
  })),
}));

vi.mock("@nullspend/db", () => ({
  actions: {
    id: "id",
    status: "status",
    expiresAt: "expiresAt",
    actionType: "actionType",
    payloadJson: "payloadJson",
    ownerUserId: "ownerUserId",
    orgId: "orgId",
    approvedAt: "approvedAt",
    rejectedAt: "rejectedAt",
    slackThreadTs: "slackThreadTs",
  },
  budgets: {
    orgId: "orgId",
    entityType: "entityType",
    entityId: "entityId",
    maxBudgetMicrodollars: "maxBudgetMicrodollars",
    spendMicrodollars: "spendMicrodollars",
    updatedAt: "updatedAt",
    userId: "userId",
  },
  ACTION_TYPES: [
    "send_email", "http_post", "http_delete", "shell_command",
    "db_write", "file_write", "file_delete", "budget_increase",
  ],
  ACTION_STATUSES: [
    "pending", "approved", "rejected", "expired",
    "executing", "executed", "failed",
  ],
}));

vi.mock("@/lib/budgets/increase", () => ({
  executeBudgetIncrease: vi.fn(),
}));

vi.mock("@/lib/proxy-invalidate", () => ({
  invalidateProxyCache: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("@/lib/webhooks/dispatch", () => ({
  dispatchWebhookEvent: vi.fn(),
  buildBudgetIncreasedPayload: vi.fn(),
}));

describe("approveAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves a pending action", async () => {
    const now = new Date();
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "pending", expiresAt: null, actionType: "http_post", payloadJson: {} },
    ]);
    mockTxUpdate.mockResolvedValue([
      { id: "action-1", status: "approved", approvedAt: now },
    ]);

    const result = await approveAction("action-1", { approvedBy: "user-1" }, "owner-1");

    expect(result.id).toBe("action-1");
    expect(result.status).toBe("approved");
    expect(result.approvedAt).toBe(now.toISOString());
  });

  it("throws ActionNotFoundError when action does not exist", async () => {
    mockTxSelect.mockResolvedValue([]);

    await expect(
      approveAction("missing", { approvedBy: "user-1" }, "owner-1"),
    ).rejects.toThrow(ActionNotFoundError);
  });

  it("throws ActionExpiredError when action has expired", async () => {
    const pastDate = new Date(Date.now() - 60_000);
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "pending", expiresAt: pastDate, actionType: "http_post", payloadJson: {} },
    ]);
    // The expiration update
    mockTxUpdate.mockResolvedValue([]);

    await expect(
      approveAction("action-1", { approvedBy: "user-1" }, "owner-1"),
    ).rejects.toThrow(ActionExpiredError);
  });

  it("throws InvalidActionTransitionError for non-pending action", async () => {
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "rejected", expiresAt: null, actionType: "http_post", payloadJson: {} },
    ]);

    await expect(
      approveAction("action-1", { approvedBy: "user-1" }, "owner-1"),
    ).rejects.toThrow(InvalidActionTransitionError);
  });

  it("throws StaleActionError on concurrent modification", async () => {
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "pending", expiresAt: null, actionType: "http_post", payloadJson: {} },
    ]);
    mockTxUpdate.mockResolvedValue([]); // 0 rows updated = concurrent mod

    await expect(
      approveAction("action-1", { approvedBy: "user-1" }, "owner-1"),
    ).rejects.toThrow(StaleActionError);
  });

  it("budget_increase action triggers executeBudgetIncrease sideEffect", async () => {
    const now = new Date();
    const payloadJson = {
      entityType: "api_key",
      entityId: "key-1",
      requestedAmountMicrodollars: 5_000_000,
      currentLimitMicrodollars: 2_000_000,
      currentSpendMicrodollars: 1_000_000,
      reason: "test",
    };

    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "pending", expiresAt: null, actionType: "budget_increase", payloadJson },
    ]);
    mockTxUpdate.mockResolvedValue([
      { id: "action-1", status: "approved", approvedAt: now },
    ]);
    mockExecuteBudgetIncrease.mockResolvedValue({
      previousLimit: 2_000_000,
      newLimit: 7_000_000,
      amount: 5_000_000,
      requestedAmount: 5_000_000,
    });

    const result = await approveAction("action-1", { approvedBy: "user-1" }, "owner-1");

    expect(mockExecuteBudgetIncrease).toHaveBeenCalledWith(
      expect.anything(),
      payloadJson,
      "owner-1",
      undefined,
    );
    expect(result.budgetIncrease).toEqual({
      previousLimit: 2_000_000,
      newLimit: 7_000_000,
      amount: 5_000_000,
      requestedAmount: 5_000_000,
    });
  });

  it("non-budget_increase action does not trigger executeBudgetIncrease", async () => {
    const now = new Date();
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "pending", expiresAt: null, actionType: "http_post", payloadJson: {} },
    ]);
    mockTxUpdate.mockResolvedValue([
      { id: "action-1", status: "approved", approvedAt: now },
    ]);

    const result = await approveAction("action-1", { approvedBy: "user-1" }, "owner-1");

    expect(mockExecuteBudgetIncrease).not.toHaveBeenCalled();
    expect(result.budgetIncrease).toBeUndefined();
  });

  it("partial approval passes approvedAmountMicrodollars to executeBudgetIncrease", async () => {
    const now = new Date();
    mockTxSelect.mockResolvedValue([
      {
        id: "action-1",
        status: "pending",
        expiresAt: null,
        actionType: "budget_increase",
        payloadJson: {
          entityType: "api_key",
          entityId: "key-1",
          requestedAmountMicrodollars: 5_000_000,
          currentLimitMicrodollars: 2_000_000,
          currentSpendMicrodollars: 1_000_000,
          reason: "test",
        },
      },
    ]);
    mockTxUpdate.mockResolvedValue([
      { id: "action-1", status: "approved", approvedAt: now },
    ]);
    mockExecuteBudgetIncrease.mockResolvedValue({
      previousLimit: 2_000_000,
      newLimit: 5_000_000,
      amount: 3_000_000,
      requestedAmount: 5_000_000,
    });

    await approveAction("action-1", { approvedBy: "user-1", approvedAmountMicrodollars: 3_000_000 }, "owner-1");

    expect(mockExecuteBudgetIncrease).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "owner-1",
      3_000_000,
    );
  });

  it("approvedAmount greater than requestedAmount is allowed (approver discretion)", async () => {
    const now = new Date();
    mockTxSelect.mockResolvedValue([
      {
        id: "action-1",
        status: "pending",
        expiresAt: null,
        actionType: "budget_increase",
        payloadJson: {
          entityType: "api_key",
          entityId: "key-1",
          requestedAmountMicrodollars: 2_000_000,
          currentLimitMicrodollars: 5_000_000,
          currentSpendMicrodollars: 4_500_000,
          reason: "test",
        },
      },
    ]);
    mockTxUpdate.mockResolvedValue([
      { id: "action-1", status: "approved", approvedAt: now },
    ]);
    mockExecuteBudgetIncrease.mockResolvedValue({
      previousLimit: 5_000_000,
      newLimit: 15_000_000,
      amount: 10_000_000,
      requestedAmount: 2_000_000,
    });

    const result = await approveAction(
      "action-1",
      { approvedBy: "user-1", approvedAmountMicrodollars: 10_000_000 },
      "owner-1",
    );

    expect(mockExecuteBudgetIncrease).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "owner-1",
      10_000_000,
    );
    expect(result.budgetIncrease?.amount).toBe(10_000_000);
    expect(result.budgetIncrease?.requestedAmount).toBe(2_000_000);
  });

  it("sideEffect failure rolls back the entire transaction", async () => {
    mockTxSelect.mockResolvedValue([
      {
        id: "action-1",
        status: "pending",
        expiresAt: null,
        actionType: "budget_increase",
        payloadJson: {
          entityType: "api_key",
          entityId: "key-1",
          requestedAmountMicrodollars: 5_000_000,
          currentLimitMicrodollars: 2_000_000,
          currentSpendMicrodollars: 1_000_000,
          reason: "test",
        },
      },
    ]);
    mockTxUpdate.mockResolvedValue([
      { id: "action-1", status: "approved", approvedAt: new Date() },
    ]);
    mockExecuteBudgetIncrease.mockRejectedValue(new Error("tier cap exceeded"));

    await expect(
      approveAction("action-1", { approvedBy: "user-1" }, "owner-1"),
    ).rejects.toThrow("tier cap exceeded");
  });
});
