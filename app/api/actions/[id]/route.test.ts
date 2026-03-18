import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/actions/[id]/route";
import { getAction } from "@/lib/actions/get-action";
import { assertApiKeyOrSession } from "@/lib/auth/dual-auth";

vi.mock("@/lib/actions/get-action", () => ({
  getAction: vi.fn(),
}));

vi.mock("@/lib/auth/dual-auth", () => ({
  assertApiKeyOrSession: vi.fn(),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureExceptionWithContext: vi.fn(),
  addSentryBreadcrumb: vi.fn(),
}));

const mockedGetAction = vi.mocked(getAction);
const mockedAssertApiKeyOrSession = vi.mocked(assertApiKeyOrSession);

describe("app/api/actions/[id]/route", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("scopes action detail reads to the resolved owner", async () => {
    mockedAssertApiKeyOrSession.mockResolvedValue("user-123");
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
      expiresAt: null,
      expiredAt: null,
      approvedBy: null,
      rejectedBy: null,
      result: null,
      errorMessage: null,
      environment: null,
      sourceFramework: null,
    });

    const response = await GET(
      new Request("http://localhost/api/actions/550e8400-e29b-41d4-a716-446655440000"),
      {
        params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440000" }),
      },
    );

    expect(mockedGetAction).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000",
      "user-123",
    );
    expect(response.status).toBe(200);
  });

  it("returns 429 when per-key rate limit is exceeded", async () => {
    const rateLimitResponse = new Response(
      JSON.stringify({ error: "rate_limit_exceeded", message: "Too many requests" }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
    mockedAssertApiKeyOrSession.mockResolvedValue(rateLimitResponse as any);

    const response = await GET(
      new Request("http://localhost/api/actions/550e8400-e29b-41d4-a716-446655440000"),
      {
        params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440000" }),
      },
    );

    expect(response.status).toBe(429);
    expect(mockedGetAction).not.toHaveBeenCalled();
  });
});
