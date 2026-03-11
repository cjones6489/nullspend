import { describe, it, expect, vi, beforeEach } from "vitest";

import { createAction } from "@/lib/actions/create-action";

const mockInsertReturning = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => ({
    insert: () => ({
      values: () => ({
        returning: mockInsertReturning,
      }),
    }),
  })),
}));

vi.mock("@agentseam/db", () => ({
  actions: {
    id: "id",
    status: "status",
    expiresAt: "expiresAt",
  },
}));

describe("createAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a pending action and returns serialized result", async () => {
    const expiresAt = new Date(Date.now() + 3600_000);
    mockInsertReturning.mockResolvedValue([
      { id: "action-1", status: "pending", expiresAt },
    ]);

    const result = await createAction(
      {
        agentId: "agent-1",
        actionType: "http_post",
        payload: { url: "https://example.com" },
      },
      "owner-1",
    );

    expect(result.id).toBe("action-1");
    expect(result.status).toBe("pending");
    expect(result.expiresAt).toBe(expiresAt.toISOString());
  });

  it("returns null expiresAt when no expiration", async () => {
    mockInsertReturning.mockResolvedValue([
      { id: "action-2", status: "pending", expiresAt: null },
    ]);

    const result = await createAction(
      {
        agentId: "agent-1",
        actionType: "send_email",
        payload: { to: "test@example.com" },
        expiresInSeconds: 0,
      },
      "owner-1",
    );

    expect(result.expiresAt).toBeNull();
  });

  it("passes metadata through to the insert", async () => {
    mockInsertReturning.mockResolvedValue([
      { id: "action-3", status: "pending", expiresAt: null },
    ]);

    const result = await createAction(
      {
        agentId: "agent-1",
        actionType: "shell_command",
        payload: { command: "echo hi" },
        metadata: { environment: "production", sourceFramework: "langchain" },
      },
      "owner-1",
    );

    expect(result.id).toBe("action-3");
  });
});
