import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { resolveSessionUserId } from "@/lib/auth/session";

vi.mock("@/lib/auth/with-api-key-auth", () => ({
  authenticateApiKey: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  resolveSessionUserId: vi.fn(),
}));

// Preserve real API_KEY_HEADER constant so the test uses the actual value
vi.mock("@/lib/auth/api-key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/api-key")>();
  return { API_KEY_HEADER: actual.API_KEY_HEADER };
});

import { assertApiKeyOrSession } from "./dual-auth";

const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);
const mockedResolveSessionUserId = vi.mocked(resolveSessionUserId);

describe("assertApiKeyOrSession", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns userId string for managed API key", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: "user-123", keyId: "key-456" });

    const request = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "ask_test123" },
    });
    const result = await assertApiKeyOrSession(request);

    expect(result).toBe("user-123");
    expect(mockedAuthenticateApiKey).toHaveBeenCalledWith(request);
    expect(mockedResolveSessionUserId).not.toHaveBeenCalled();
  });

  it("returns userId string for dev fallback key", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: "dev-user", keyId: null });

    const request = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "env-secret" },
    });
    const result = await assertApiKeyOrSession(request);

    expect(result).toBe("dev-user");
  });

  it("returns 429 Response when per-key rate limit exceeded", async () => {
    const rateLimitResponse = new Response(
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Too many requests", details: null } }),
      { status: 429 },
    );
    mockedAuthenticateApiKey.mockResolvedValue(rateLimitResponse);

    const request = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "ask_test123" },
    });
    const result = await assertApiKeyOrSession(request);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(429);
  });

  it("falls back to session auth when no API key header present", async () => {
    mockedResolveSessionUserId.mockResolvedValue("session-user-789");

    const request = new Request("http://localhost/api/actions");
    const result = await assertApiKeyOrSession(request);

    expect(result).toBe("session-user-789");
    expect(mockedAuthenticateApiKey).not.toHaveBeenCalled();
    expect(mockedResolveSessionUserId).toHaveBeenCalled();
  });

  it("propagates ApiKeyError from authenticateApiKey", async () => {
    mockedAuthenticateApiKey.mockRejectedValue(new Error("Invalid or missing API key."));

    const request = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "ask_bogus" },
    });

    await expect(assertApiKeyOrSession(request)).rejects.toThrow("Invalid or missing API key.");
  });
});
