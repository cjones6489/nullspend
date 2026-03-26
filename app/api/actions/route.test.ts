import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAction } from "@/lib/actions/create-action";
import { listActions } from "@/lib/actions/list-actions";
import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { resolveSessionContext } from "@/lib/auth/session";
import { sendSlackNotification } from "@/lib/slack/notify";
import { GET, POST } from "@/app/api/actions/route";

vi.mock("@/lib/actions/create-action", () => ({
  createAction: vi.fn(),
}));

vi.mock("@/lib/actions/list-actions", () => ({
  listActions: vi.fn(),
}));

vi.mock("@/lib/auth/with-api-key-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/with-api-key-auth")>();
  return {
    ...actual,
    authenticateApiKey: vi.fn(),
  };
});

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn().mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" }),
  assertOrgMember: vi.fn().mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" }),
}));

vi.mock("@/lib/slack/notify", () => ({
  sendSlackNotification: vi.fn(),
}));

const mockedCreateAction = vi.mocked(createAction);
const mockedListActions = vi.mocked(listActions);
const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);
const mockedResolveSessionContext = vi.mocked(resolveSessionContext);
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
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-123",
      orgId: "org-test-1",
      keyId: "key-123",
      apiVersion: "2026-04-01",
    });
    mockedCreateAction.mockResolvedValue(makeActionRecord());

    const response = await POST(
      new Request("http://localhost/api/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nullspend-key": "ns_live_sk_0123456789abcdef0123456789abcdef",
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
      "org-test-1",
    );
    expect(response.status).toBe(201);

    expect(mockedSendSlackNotification).toHaveBeenCalledWith(
      expect.objectContaining({ id: "550e8400-e29b-41d4-a716-446655440000" }),
      "org-test-1",
    );
  });

  it("uses the dev actor only for env-key fallback ownership", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "dev-user",
      orgId: "org-test-1",
      keyId: null,
      apiVersion: "2026-04-01",
    });
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
      "org-test-1",
    );
  });

  it("returns 201 even when Slack notification fails", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-123",
      orgId: "org-test-1",
      keyId: "key-123",
      apiVersion: "2026-04-01",
    });
    mockedCreateAction.mockResolvedValue(makeActionRecord());
    mockedSendSlackNotification.mockRejectedValue(new Error("Webhook error"));

    const response = await POST(
      new Request("http://localhost/api/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nullspend-key": "ns_live_sk_0123456789abcdef0123456789abcdef",
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
    expect(json.data.id).toBe("ns_act_550e8400-e29b-41d4-a716-446655440000");
  });

  it("returns 429 when per-key rate limit is exceeded", async () => {
    const rateLimitResponse = new Response(
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Too many requests", details: null } }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
    mockedAuthenticateApiKey.mockResolvedValue(rateLimitResponse);

    const response = await POST(
      new Request("http://localhost/api/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nullspend-key": "ns_live_sk_0123456789abcdef0123456789abcdef",
        },
        body: JSON.stringify({
          agentId: "agent-1",
          actionType: "http_post",
          payload: { url: "https://example.com" },
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(mockedCreateAction).not.toHaveBeenCalled();
  });

  it("lists actions scoped to the resolved session user", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" });
    mockedListActions.mockResolvedValue({
      data: [],
      cursor: null,
    });

    const cursorObj = { createdAt: "2026-03-07T12:00:00.000Z", id: "ns_act_00000000-0000-4000-a000-000000000001" };
    const cursorParam = encodeURIComponent(JSON.stringify(cursorObj));

    const response = await GET(
      new Request(
        `http://localhost/api/actions?status=pending&limit=25&cursor=${cursorParam}`,
      ),
    );

    expect(mockedListActions).toHaveBeenCalledWith({
      orgId: "org-test-1",
      status: "pending",
      limit: 25,
      cursor: { createdAt: "2026-03-07T12:00:00.000Z", id: "00000000-0000-4000-a000-000000000001" },
    });
    expect(response.status).toBe(200);
  });

  it("returns prefixed IDs in cursor for pagination round-trip", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" });
    mockedListActions.mockResolvedValue({
      data: [makeActionRecord()],
      cursor: {
        createdAt: "2026-03-07T12:00:00.000Z",
        id: "00000000-0000-4000-a000-000000000002",
      },
    });

    const response = await GET(
      new Request("http://localhost/api/actions?limit=1"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.cursor).toEqual({
      createdAt: "2026-03-07T12:00:00.000Z",
      id: "ns_act_00000000-0000-4000-a000-000000000002",
    });
    // Data IDs are also prefixed
    expect(json.data.data[0].id).toBe("ns_act_550e8400-e29b-41d4-a716-446655440000");
  });

  it("passes statuses array to listActions when provided", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "user-123", orgId: "org-test-1", role: "owner" });
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
      orgId: "org-test-1",
      statuses: ["approved", "executed", "failed"],
      limit: 50,
    });
    expect(response.status).toBe(200);
  });
});
