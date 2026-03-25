import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/actions/[id]/result/route";
import { markResult } from "@/lib/actions/mark-result";
import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";

vi.mock("@/lib/actions/mark-result", () => ({
  markResult: vi.fn(),
}));

vi.mock("@/lib/auth/with-api-key-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/with-api-key-auth")>();
  return {
    ...actual,
    authenticateApiKey: vi.fn(),
  };
});

const mockedMarkResult = vi.mocked(markResult);
const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);

describe("app/api/actions/[id]/result/route", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("scopes result writes to the managed API key owner", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "user-123",
      orgId: "org-test-1",
      keyId: "key-123",
      apiVersion: "2026-04-01",
    });
    mockedMarkResult.mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440000",
      status: "executed",
      executedAt: "2026-03-07T12:00:00.000Z",
    });

    const response = await POST(
      new Request("http://localhost/api/actions/ns_act_550e8400-e29b-41d4-a716-446655440000/result", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nullspend-key": "ns_live_sk_0123456789abcdef0123456789abcdef",
        },
        body: JSON.stringify({
          status: "executed",
          result: { ok: true },
        }),
      }),
      {
        params: Promise.resolve({ id: "ns_act_550e8400-e29b-41d4-a716-446655440000" }),
      },
    );

    expect(mockedMarkResult).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000",
      { status: "executed", result: { ok: true } },
      "org-test-1",
    );
    expect(response.status).toBe(200);
  });

  it("uses the dev actor only for env-key fallback result writes", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({
      userId: "dev-user",
      orgId: "org-test-1",
      keyId: null,
      apiVersion: "2026-04-01",
    });
    mockedMarkResult.mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440000",
      status: "failed",
      executedAt: "2026-03-07T12:00:00.000Z",
    });

    await POST(
      new Request("http://localhost/api/actions/ns_act_550e8400-e29b-41d4-a716-446655440000/result", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nullspend-key": "env-secret",
        },
        body: JSON.stringify({
          status: "failed",
          errorMessage: "boom",
        }),
      }),
      {
        params: Promise.resolve({ id: "ns_act_550e8400-e29b-41d4-a716-446655440000" }),
      },
    );

    expect(mockedMarkResult).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000",
      { status: "failed", errorMessage: "boom" },
      "org-test-1",
    );
  });

  it("returns 429 when per-key rate limit is exceeded", async () => {
    const rateLimitResponse = new Response(
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Too many requests", details: null } }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
    mockedAuthenticateApiKey.mockResolvedValue(rateLimitResponse);

    const response = await POST(
      new Request("http://localhost/api/actions/ns_act_550e8400-e29b-41d4-a716-446655440000/result", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nullspend-key": "ns_live_sk_0123456789abcdef0123456789abcdef",
        },
        body: JSON.stringify({
          status: "executed",
          result: { ok: true },
        }),
      }),
      {
        params: Promise.resolve({ id: "ns_act_550e8400-e29b-41d4-a716-446655440000" }),
      },
    );

    expect(response.status).toBe(429);
    expect(mockedMarkResult).not.toHaveBeenCalled();
  });
});
