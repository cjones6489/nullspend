import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/actions/[id]/result/route";
import { markResult } from "@/lib/actions/mark-result";
import {
  assertApiKeyWithIdentity,
  resolveDevFallbackApiKeyUserId,
} from "@/lib/auth/api-key";

vi.mock("@/lib/actions/mark-result", () => ({
  markResult: vi.fn(),
}));

vi.mock("@/lib/auth/api-key", () => ({
  assertApiKeyWithIdentity: vi.fn(),
  resolveDevFallbackApiKeyUserId: vi.fn(),
}));

const mockedMarkResult = vi.mocked(markResult);
const mockedAssertApiKeyWithIdentity = vi.mocked(assertApiKeyWithIdentity);
const mockedResolveDevFallbackApiKeyUserId = vi.mocked(
  resolveDevFallbackApiKeyUserId,
);

describe("app/api/actions/[id]/result/route", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("scopes result writes to the managed API key owner", async () => {
    mockedAssertApiKeyWithIdentity.mockResolvedValue({
      keyId: "key-123",
      userId: "user-123",
    });
    mockedMarkResult.mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440000",
      status: "executed",
      executedAt: "2026-03-07T12:00:00.000Z",
    });

    const response = await POST(
      new Request("http://localhost/api/actions/550e8400-e29b-41d4-a716-446655440000/result", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agentseam-key": "ask_0123456789abcdef0123456789abcdef",
        },
        body: JSON.stringify({
          status: "executed",
          result: { ok: true },
        }),
      }),
      {
        params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440000" }),
      },
    );

    expect(mockedMarkResult).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000",
      { status: "executed", result: { ok: true } },
      "user-123",
    );
    expect(response.status).toBe(200);
  });

  it("uses the dev actor only for env-key fallback result writes", async () => {
    mockedAssertApiKeyWithIdentity.mockResolvedValue(null);
    mockedResolveDevFallbackApiKeyUserId.mockReturnValue("dev-user");
    mockedMarkResult.mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440000",
      status: "failed",
      executedAt: "2026-03-07T12:00:00.000Z",
    });

    await POST(
      new Request("http://localhost/api/actions/550e8400-e29b-41d4-a716-446655440000/result", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agentseam-key": "env-secret",
        },
        body: JSON.stringify({
          status: "failed",
          errorMessage: "boom",
        }),
      }),
      {
        params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440000" }),
      },
    );

    expect(mockedMarkResult).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000",
      { status: "failed", errorMessage: "boom" },
      "dev-user",
    );
  });
});
