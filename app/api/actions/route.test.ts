import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAction } from "@/lib/actions/create-action";
import { listActions } from "@/lib/actions/list-actions";
import {
  assertApiKeyWithIdentity,
  resolveDevFallbackApiKeyUserId,
} from "@/lib/auth/api-key";
import { resolveSessionUserId } from "@/lib/auth/session";
import { sendSlackNotification } from "@/lib/slack/notify";
import { GET, POST } from "@/app/api/actions/route";

vi.mock("@/lib/actions/create-action", () => ({
  createAction: vi.fn(),
}));

vi.mock("@/lib/actions/list-actions", () => ({
  listActions: vi.fn(),
}));

vi.mock("@/lib/auth/api-key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/api-key")>();
  return {
    ...actual,
    assertApiKeyWithIdentity: vi.fn(),
    resolveDevFallbackApiKeyUserId: vi.fn(),
  };
});

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

vi.mock("@/lib/slack/notify", () => ({
  sendSlackNotification: vi.fn(),
}));

const mockedCreateAction = vi.mocked(createAction);
const mockedListActions = vi.mocked(listActions);
const mockedAssertApiKeyWithIdentity = vi.mocked(assertApiKeyWithIdentity);
const mockedResolveDevFallbackApiKeyUserId = vi.mocked(
  resolveDevFallbackApiKeyUserId,
);
const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);
const mockedSendSlackNotification = vi.mocked(sendSlackNotification);

function makeActionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    agentId: "agent-1",
    actionType: "http_post" as const,
    status: "pending" as const,
    payload: { url: "https://example.com" },
    metadata: null,
    createdAt: "2026-03-07T12:00:00.000Z",
    approvedAt: null,
    rejectedAt: null,
    executedAt: null,
    expiresAt: "2026-03-07T13:00:00.000Z",
    expiredAt: null,
    approvedBy: null,
    rejectedBy: null,
    result: null,
    errorMessage: null,
    environment: null,
    sourceFramework: null,
    ...overrides,
  };
}

describe("app/api/actions/route", () => {
  beforeEach(() => {
    mockedSendSlackNotification.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("creates actions for the managed API key owner", async () => {
    mockedAssertApiKeyWithIdentity.mockResolvedValue({
      keyId: "key-123",
      userId: "user-123",
    });
    mockedCreateAction.mockResolvedValue(makeActionRecord());

    const response = await POST(
      new Request("http://localhost/api/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nullspend-key": "ask_0123456789abcdef0123456789abcdef",
        },
        body: JSON.stringify({
          agentId: "agent-1",
          actionType: "http_post",
          payload: { url: "https://example.com" },
        }),
      }),
    );

    expect(mockedCreateAction).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1" }),
      "user-123",
    );
    expect(response.status).toBe(201);

    expect(mockedSendSlackNotification).toHaveBeenCalledWith(
      expect.objectContaining({ id: "550e8400-e29b-41d4-a716-446655440000" }),
      "user-123",
    );
  });

  it("uses the dev actor only for env-key fallback ownership", async () => {
    mockedAssertApiKeyWithIdentity.mockResolvedValue(null);
    mockedResolveDevFallbackApiKeyUserId.mockReturnValue("dev-user");
    mockedCreateAction.mockResolvedValue(makeActionRecord());

    await POST(
      new Request("http://localhost/api/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nullspend-key": "env-secret",
        },
        body: JSON.stringify({
          agentId: "agent-1",
          actionType: "http_post",
          payload: { url: "https://example.com" },
        }),
      }),
    );

    expect(mockedCreateAction).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1" }),
      "dev-user",
    );
  });

  it("returns 201 even when Slack notification fails", async () => {
    mockedAssertApiKeyWithIdentity.mockResolvedValue({
      keyId: "key-123",
      userId: "user-123",
    });
    mockedCreateAction.mockResolvedValue(makeActionRecord());
    mockedSendSlackNotification.mockRejectedValue(new Error("Webhook error"));

    const response = await POST(
      new Request("http://localhost/api/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nullspend-key": "ask_0123456789abcdef0123456789abcdef",
        },
        body: JSON.stringify({
          agentId: "agent-1",
          actionType: "http_post",
          payload: { url: "https://example.com" },
        }),
      }),
    );

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("lists actions scoped to the resolved session user", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockedListActions.mockResolvedValue({
      data: [],
      cursor: null,
    });

    const cursorObj = { createdAt: "2026-03-07T12:00:00.000Z", id: "00000000-0000-4000-a000-000000000001" };
    const cursorParam = encodeURIComponent(JSON.stringify(cursorObj));

    const response = await GET(
      new Request(
        `http://localhost/api/actions?status=pending&limit=25&cursor=${cursorParam}`,
      ),
    );

    expect(mockedListActions).toHaveBeenCalledWith({
      ownerUserId: "user-123",
      status: "pending",
      limit: 25,
      cursor: cursorObj,
    });
    expect(response.status).toBe(200);
  });

  it("passes statuses array to listActions when provided", async () => {
    mockedResolveSessionUserId.mockResolvedValue("user-123");
    mockedListActions.mockResolvedValue({
      data: [],
      cursor: null,
    });

    const response = await GET(
      new Request(
        "http://localhost/api/actions?statuses=approved,executed,failed",
      ),
    );

    expect(mockedListActions).toHaveBeenCalledWith({
      ownerUserId: "user-123",
      statuses: ["approved", "executed", "failed"],
      limit: 50,
    });
    expect(response.status).toBe(200);
  });
});
