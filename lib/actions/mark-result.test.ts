import { describe, it, expect, vi, beforeEach } from "vitest";

import { markResult } from "@/lib/actions/mark-result";
import {
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
    ownerUserId: "ownerUserId",
    executedAt: "executedAt",
  },
}));

describe("markResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks an approved action as executing", async () => {
    const _now = new Date();
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "approved" },
    ]);
    mockTxUpdate.mockResolvedValue([
      { id: "action-1", status: "executing", executedAt: null },
    ]);

    const result = await markResult("action-1", { status: "executing" }, "owner-1");

    expect(result.id).toBe("action-1");
    expect(result.status).toBe("executing");
  });

  it("marks an executing action as executed with result", async () => {
    const now = new Date();
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "executing" },
    ]);
    mockTxUpdate.mockResolvedValue([
      { id: "action-1", status: "executed", executedAt: now },
    ]);

    const result = await markResult(
      "action-1",
      { status: "executed", result: { output: "done" } },
      "owner-1",
    );

    expect(result.status).toBe("executed");
    expect(result.executedAt).toBe(now.toISOString());
  });

  it("marks an executing action as failed with error message", async () => {
    const now = new Date();
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "executing" },
    ]);
    mockTxUpdate.mockResolvedValue([
      { id: "action-1", status: "failed", executedAt: now },
    ]);

    const result = await markResult(
      "action-1",
      { status: "failed", errorMessage: "timeout" },
      "owner-1",
    );

    expect(result.status).toBe("failed");
  });

  it("throws ActionNotFoundError when action does not exist", async () => {
    mockTxSelect.mockResolvedValue([]);

    await expect(
      markResult("missing", { status: "executing" }, "owner-1"),
    ).rejects.toThrow(ActionNotFoundError);
  });

  it("throws InvalidActionTransitionError for invalid transition", async () => {
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "pending" },
    ]);

    await expect(
      markResult("action-1", { status: "executed" }, "owner-1"),
    ).rejects.toThrow(InvalidActionTransitionError);
  });

  it("throws StaleActionError on concurrent modification", async () => {
    mockTxSelect.mockResolvedValue([
      { id: "action-1", status: "approved" },
    ]);
    mockTxUpdate.mockResolvedValue([]);

    await expect(
      markResult("action-1", { status: "executing" }, "owner-1"),
    ).rejects.toThrow(StaleActionError);
  });
});
