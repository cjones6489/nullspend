import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { resolveSessionContext } from "@/lib/auth/session";

vi.mock("@/lib/auth/with-api-key-auth", () => ({
  authenticateApiKey: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgRole: vi.fn(),
}));

// Preserve real API_KEY_HEADER constant so the test uses the actual value
vi.mock("@/lib/auth/api-key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/api-key")>();
  return { API_KEY_HEADER: actual.API_KEY_HEADER };
});

import { assertApiKeyOrSession } from "./dual-auth";

const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);
const mockedResolveSessionContext = vi.mocked(resolveSessionContext);

describe("assertApiKeyOrSession", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns DualAuthResult for managed API key", async () => {
    // API-1: authenticateApiKey now includes membership check internally
    mockedAuthenticateApiKey.mockResolvedValue({ userId: "user-123", orgId: "org-123", keyId: "key-456", apiVersion: "2026-04-01" });

    const request = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "ns_live_sk_test0001" },
    });
    const result = await assertApiKeyOrSession(request);

    expect(result).toEqual({ userId: "user-123", orgId: "org-123" });
    expect(mockedAuthenticateApiKey).toHaveBeenCalledWith(request);
    expect(mockedResolveSessionContext).not.toHaveBeenCalled();
  });

  it("returns 403 for API key without orgId (dev fallback)", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: "dev-user", orgId: null, keyId: null, apiVersion: "2026-04-01" });

    const request = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "env-secret" },
    });
    const result = await assertApiKeyOrSession(request);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    const body = await (result as Response).json();
    expect(body.error.code).toBe("configuration_error");
  });

  it("returns 429 Response when per-key rate limit exceeded", async () => {
    const rateLimitResponse = new Response(
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Too many requests", details: null } }),
      { status: 429 },
    );
    mockedAuthenticateApiKey.mockResolvedValue(rateLimitResponse);

    const request = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "ns_live_sk_test0001" },
    });
    const result = await assertApiKeyOrSession(request);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(429);
  });

  it("returns 403 when authenticateApiKey returns 403 (membership check failed)", async () => {
    // API-1: authenticateApiKey now returns 403 for non-member API keys
    const forbiddenResponse = new Response(
      JSON.stringify({ error: { code: "forbidden", message: "API key owner is no longer a member.", details: null } }),
      { status: 403 },
    );
    mockedAuthenticateApiKey.mockResolvedValue(forbiddenResponse);

    const request = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "ns_live_sk_test0001" },
    });
    const result = await assertApiKeyOrSession(request);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it("falls back to session auth when no API key header present", async () => {
    mockedResolveSessionContext.mockResolvedValue({ userId: "session-user-789", orgId: "org-789", role: "owner" });

    const request = new Request("http://localhost/api/actions");
    const result = await assertApiKeyOrSession(request);

    expect(result).toEqual({ userId: "session-user-789", orgId: "org-789" });
    expect(mockedAuthenticateApiKey).not.toHaveBeenCalled();
    expect(mockedResolveSessionContext).toHaveBeenCalled();
  });

  it("propagates ApiKeyError from authenticateApiKey", async () => {
    mockedAuthenticateApiKey.mockRejectedValue(new Error("Invalid or missing API key."));

    const request = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "ns_live_sk_bogus0001" },
    });

    await expect(assertApiKeyOrSession(request)).rejects.toThrow("Invalid or missing API key.");
  });
});
