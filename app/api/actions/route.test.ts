import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAction } from "@/lib/actions/create-action";
import { getAction } from "@/lib/actions/get-action";
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

vi.mock("@/lib/actions/get-action", () => ({
  getAction: vi.fn(),
}));

vi.mock("@/lib/actions/list-actions", () => ({
  listActions: vi.fn(),
}));

vi.mock("@/lib/auth/api-key", () => ({
  assertApiKeyWithIdentity: vi.fn(),
  resolveDevFallbackApiKeyUserId: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

vi.mock("@/lib/slack/notify", () => ({
  sendSlackNotification: vi.fn(),
}));

const mockedCreateAction = vi.mocked(createAction);
const mockedGetAction = vi.mocked(getAction);
const mockedListActions = vi.mocked(listActions);
const mockedAssertApiKeyWithIdentity = vi.mocked(assertApiKeyWithIdentity);
const mockedResolveDevFallbackApiKeyUserId = vi.mocked(
  resolveDevFallbackApiKeyUserId,
);
const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);
const mockedSendSlackNotification = vi.mocked(sendSlackNotification);

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
    mockedCreateAction.mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440000",
      status: "pending",
      expiresAt: "2026-03-07T13:00:00.000Z",
    });
    mockedGetAction.mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440000",
      agentId: "agent-1",
      actionType: "http_post",
      status: "pending",
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
    });

    const response = await POST(
      new Request("http://localhost/api/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agentseam-key": "ask_0123456789abcdef0123456789abcdef",
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
  });

  it("uses the dev actor only for env-key fallback ownership", async () => {
    mockedAssertApiKeyWithIdentity.mockResolvedValue(null);
    mockedResolveDevFallbackApiKeyUserId.mockReturnValue("dev-user");
    mockedCreateAction.mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440000",
      status: "pending",
      expiresAt: "2026-03-07T13:00:00.000Z",
    });
    mockedGetAction.mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440000",
      agentId: "agent-1",
      actionType: "http_post",
      status: "pending",
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
    });

    await POST(
      new Request("http://localhost/api/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agentseam-key": "env-secret",
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

  it("returns 201 even when getAction throws (notification lookup failure)", async () => {
    mockedAssertApiKeyWithIdentity.mockResolvedValue({
      keyId: "key-123",
      userId: "user-123",
    });
    mockedCreateAction.mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440000",
      status: "pending",
      expiresAt: "2026-03-07T13:00:00.000Z",
    });
    mockedGetAction.mockRejectedValue(new Error("DB connection lost"));

    const response = await POST(
      new Request("http://localhost/api/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agentseam-key": "ask_0123456789abcdef0123456789abcdef",
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

    const response = await GET(
      new Request(
        "http://localhost/api/actions?status=pending&limit=25&cursor=2026-03-07T12:00:00.000Z",
      ),
    );

    expect(mockedListActions).toHaveBeenCalledWith({
      ownerUserId: "user-123",
      status: "pending",
      limit: 25,
      cursor: "2026-03-07T12:00:00.000Z",
    });
    expect(response.status).toBe(200);
  });
});
