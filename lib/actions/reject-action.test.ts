import { describe, it, expect, vi, beforeEach } from "vitest";

import { rejectAction } from "@/lib/actions/reject-action";
import {
  ActionExpiredError,
  ActionNotFoundError,
  StaleActionError,
  InvalidActionTransitionError,
} from "@/lib/actions/errors";

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
    ownerUserId: "ownerUserId",
    approvedAt: "approvedAt",
    rejectedAt: "rejectedAt",
  },
}));

describe("rejectAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a pending action", async () => {
    const now = new Date();
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "pending", expiresAt: null },
    ]);
    mockTxUpdate.mockResolvedValue([
      { id: "action-1", status: "rejected", rejectedAt: now },
    ]);

    const result = await rejectAction("action-1", { rejectedBy: "user-1" }, "owner-1");

    expect(result.id).toBe("action-1");
    expect(result.status).toBe("rejected");
    expect(result.rejectedAt).toBe(now.toISOString());
  });

  it("throws ActionNotFoundError when action does not exist", async () => {
    mockTxSelect.mockResolvedValue([]);

    await expect(
      rejectAction("missing", { rejectedBy: "user-1" }, "owner-1"),
    ).rejects.toThrow(ActionNotFoundError);
  });

  it("throws ActionExpiredError when action has expired", async () => {
    const pastDate = new Date(Date.now() - 60_000);
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "pending", expiresAt: pastDate },
    ]);
    mockTxUpdate.mockResolvedValue([]);

    await expect(
      rejectAction("action-1", { rejectedBy: "user-1" }, "owner-1"),
    ).rejects.toThrow(ActionExpiredError);
  });

  it("throws InvalidActionTransitionError for non-pending action", async () => {
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "approved", expiresAt: null },
    ]);

    await expect(
      rejectAction("action-1", { rejectedBy: "user-1" }, "owner-1"),
    ).rejects.toThrow(InvalidActionTransitionError);
  });

  it("throws StaleActionError on concurrent modification", async () => {
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "pending", expiresAt: null },
    ]);
    mockTxUpdate.mockResolvedValue([]);

    await expect(
      rejectAction("action-1", { rejectedBy: "user-1" }, "owner-1"),
    ).rejects.toThrow(StaleActionError);
  });
});
