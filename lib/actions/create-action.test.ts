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

vi.mock("@nullspend/db", () => ({
  actions: {},
}));

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "action-1",
    agentId: "agent-1",
    actionType: "http_post",
    status: "pending",
    ownerUserId: "owner-1",
    payloadJson: { url: "https://example.com" },
    metadataJson: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    approvedAt: null,
    rejectedAt: null,
    executedAt: null,
    expiresAt: null,
    expiredAt: null,
    approvedBy: null,
    rejectedBy: null,
    resultJson: null,
    errorMessage: null,
    environment: null,
    sourceFramework: null,
    ...overrides,
  };
}

describe("createAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a pending action and returns serialized result", async () => {
    const expiresAt = new Date(Date.now() + 3600_000);
    mockInsertReturning.mockResolvedValue([makeRow({ expiresAt })]);

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
    expect(result.agentId).toBe("agent-1");
    expect(result.actionType).toBe("http_post");
  });

  it("returns null expiresAt when no expiration", async () => {
    mockInsertReturning.mockResolvedValue([makeRow()]);

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
      makeRow({
        metadataJson: { environment: "production", sourceFramework: "langchain" },
        environment: "production",
        sourceFramework: "langchain",
      }),
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

    expect(result.id).toBe("action-1");
    expect(result.metadata).toEqual({ environment: "production", sourceFramework: "langchain" });
  });
});
