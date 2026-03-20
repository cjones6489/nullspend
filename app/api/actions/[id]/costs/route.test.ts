import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/actions/[id]/costs/route";
import { getAction } from "@/lib/actions/get-action";
import { ActionNotFoundError } from "@/lib/actions/errors";
import { assertApiKeyOrSession } from "@/lib/auth/dual-auth";
import { AuthenticationRequiredError } from "@/lib/auth/errors";
import { getCostEventsByActionId } from "@/lib/cost-events/get-cost-events-by-action";

vi.mock("@/lib/actions/get-action", () => ({
  getAction: vi.fn(),
}));

vi.mock("@/lib/auth/dual-auth", () => ({
  assertApiKeyOrSession: vi.fn(),
}));

vi.mock("@/lib/cost-events/get-cost-events-by-action", () => ({
  getCostEventsByActionId: vi.fn(),
}));

const mockedGetAction = vi.mocked(getAction);
const mockedAssertApiKeyOrSession = vi.mocked(assertApiKeyOrSession);
const mockedGetCostEventsByActionId = vi.mocked(getCostEventsByActionId);

const ACTION_UUID = "550e8400-e29b-41d4-a716-446655440000";
const ACTION_ID = `ns_act_${ACTION_UUID}`;

function makeRequest() {
  return new Request(`http://localhost/api/actions/${ACTION_ID}/costs`);
}

function makeContext() {
  return { params: Promise.resolve({ id: ACTION_ID }) };
}

describe("GET /api/actions/[id]/costs", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns cost events for a valid action owned by the user", async () => {
    mockedAssertApiKeyOrSession.mockResolvedValue("user-123");
    mockedGetAction.mockResolvedValue({
      id: ACTION_UUID,
      agentId: "agent-1",
      actionType: "http_post",
      status: "executed",
      payload: {},
      metadata: null,
      createdAt: "2026-03-07T12:00:00.000Z",
      approvedAt: "2026-03-07T12:01:00.000Z",
      rejectedAt: null,
      executedAt: "2026-03-07T12:02:00.000Z",
      expiresAt: null,
      expiredAt: null,
      approvedBy: "user-123",
      rejectedBy: null,
      result: { ok: true },
      errorMessage: null,
      environment: null,
      sourceFramework: null,
    });
    mockedGetCostEventsByActionId.mockResolvedValue([
      {
        id: "550e8400-e29b-41d4-a716-446655440001",
        requestId: "req-abc",
        apiKeyId: "550e8400-e29b-41d4-a716-446655440002",
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        cachedInputTokens: 200,
        reasoningTokens: 0,
        costMicrodollars: 7250,
        durationMs: 1500,
        createdAt: "2026-03-07T12:02:00.000Z",
        traceId: null,
        source: "proxy",
        keyName: "My Key",
      },
    ]);

    const response = await GET(makeRequest(), makeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("ns_evt_550e8400-e29b-41d4-a716-446655440001");
    expect(body.data[0].apiKeyId).toBe("ns_key_550e8400-e29b-41d4-a716-446655440002");
    expect(body.data[0].model).toBe("gpt-4o");
    expect(body.data[0].costMicrodollars).toBe(7250);

    expect(mockedAssertApiKeyOrSession).toHaveBeenCalled();
    expect(mockedGetAction).toHaveBeenCalledWith(ACTION_UUID, "user-123");
    expect(mockedGetCostEventsByActionId).toHaveBeenCalledWith(ACTION_UUID, "user-123");
  });

  it("returns empty array when action has no cost events", async () => {
    mockedAssertApiKeyOrSession.mockResolvedValue("user-123");
    mockedGetAction.mockResolvedValue({
      id: ACTION_UUID,
      agentId: "agent-1",
      actionType: "send_email",
      status: "executed",
      payload: {},
      metadata: null,
      createdAt: "2026-03-07T12:00:00.000Z",
      approvedAt: null,
      rejectedAt: null,
      executedAt: null,
      expiresAt: null,
      expiredAt: null,
      approvedBy: null,
      rejectedBy: null,
      result: null,
      errorMessage: null,
      environment: null,
      sourceFramework: null,
    });
    mockedGetCostEventsByActionId.mockResolvedValue([]);

    const response = await GET(makeRequest(), makeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("returns 404 when action does not belong to the user", async () => {
    mockedAssertApiKeyOrSession.mockResolvedValue("user-123");
    mockedGetAction.mockRejectedValue(new ActionNotFoundError(ACTION_ID));

    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(404);
    expect(mockedGetCostEventsByActionId).not.toHaveBeenCalled();
  });

  it("returns 401 when authentication fails", async () => {
    mockedAssertApiKeyOrSession.mockRejectedValue(
      new AuthenticationRequiredError(),
    );

    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(401);
    expect(mockedGetAction).not.toHaveBeenCalled();
    expect(mockedGetCostEventsByActionId).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid action ID format", async () => {
    mockedAssertApiKeyOrSession.mockResolvedValue("user-123");

    const response = await GET(
      new Request("http://localhost/api/actions/not-a-uuid/costs"),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(response.status).toBe(400);
    expect(mockedGetAction).not.toHaveBeenCalled();
  });

  it("returns 429 when per-key rate limit is exceeded", async () => {
    const rateLimitResponse = new Response(
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Too many requests", details: null } }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
    mockedAssertApiKeyOrSession.mockResolvedValue(rateLimitResponse as any);

    const response = await GET(makeRequest(), makeContext());

    expect(response.status).toBe(429);
    expect(mockedGetAction).not.toHaveBeenCalled();
    expect(mockedGetCostEventsByActionId).not.toHaveBeenCalled();
  });
});
