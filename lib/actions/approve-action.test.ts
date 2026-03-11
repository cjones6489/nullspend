import { describe, it, expect, vi, beforeEach } from "vitest";

import { approveAction } from "@/lib/actions/approve-action";
import {
  ActionExpiredError,
  ActionNotFoundError,
  StaleActionError,
  InvalidActionTransitionError,
} from "@/lib/actions/errors";

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
              limit: mockTxSelect,
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

vi.mock("@agentseam/db", () => ({
  actions: {
    id: "id",
    status: "status",
    expiresAt: "expiresAt",
    ownerUserId: "ownerUserId",
    approvedAt: "approvedAt",
  },
}));

describe("approveAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves a pending action", async () => {
    const now = new Date();
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "pending", expiresAt: null },
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
      { id: "action-1", status: "pending", expiresAt: pastDate },
    ]);
    // The expiration update
    mockTxUpdate.mockResolvedValue([]);

    await expect(
      approveAction("action-1", { approvedBy: "user-1" }, "owner-1"),
    ).rejects.toThrow(ActionExpiredError);
  });

  it("throws InvalidActionTransitionError for non-pending action", async () => {
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "rejected", expiresAt: null },
    ]);

    await expect(
      approveAction("action-1", { approvedBy: "user-1" }, "owner-1"),
    ).rejects.toThrow(InvalidActionTransitionError);
  });

  it("throws StaleActionError on concurrent modification", async () => {
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "pending", expiresAt: null },
    ]);
    mockTxUpdate.mockResolvedValue([]); // 0 rows updated = concurrent mod

    await expect(
      approveAction("action-1", { approvedBy: "user-1" }, "owner-1"),
    ).rejects.toThrow(StaleActionError);
  });
});
