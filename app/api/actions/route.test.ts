import { afterEach, describe, expect, it, vi } from "vitest";

import { createAction } from "@/lib/actions/create-action";
import { listActions } from "@/lib/actions/list-actions";
import {
  assertApiKeyWithIdentity,
  resolveDevFallbackApiKeyUserId,
} from "@/lib/auth/api-key";
import { resolveSessionUserId } from "@/lib/auth/session";
import { GET, POST } from "@/app/api/actions/route";

vi.mock("@/lib/actions/create-action", () => ({
  createAction: vi.fn(),
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

const mockedCreateAction = vi.mocked(createAction);
const mockedListActions = vi.mocked(listActions);
const mockedAssertApiKeyWithIdentity = vi.mocked(assertApiKeyWithIdentity);
const mockedResolveDevFallbackApiKeyUserId = vi.mocked(
  resolveDevFallbackApiKeyUserId,
);
const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);

describe("app/api/actions/route", () => {
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
