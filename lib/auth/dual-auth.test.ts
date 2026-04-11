import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateApiKey } from "@/lib/auth/with-api-key-auth";
import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgMember } from "@/lib/auth/org-authorization";
import { ForbiddenError } from "@/lib/auth/errors";

vi.mock("@/lib/auth/with-api-key-auth", () => ({
  authenticateApiKey: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  resolveSessionContext: vi.fn(),
}));

vi.mock("@/lib/auth/org-authorization", () => ({
  assertOrgMember: vi.fn(),
  assertOrgRole: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({
  getLogger: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Preserve real API_KEY_HEADER constant so the test uses the actual value
vi.mock("@/lib/auth/api-key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/api-key")>();
  return { API_KEY_HEADER: actual.API_KEY_HEADER };
});

import { assertApiKeyOrSession } from "./dual-auth";

const mockedAuthenticateApiKey = vi.mocked(authenticateApiKey);
const mockedResolveSessionContext = vi.mocked(resolveSessionContext);
const mockedAssertOrgMember = vi.mocked(assertOrgMember);

describe("assertApiKeyOrSession", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns DualAuthResult for managed API key when user is org member", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: "user-123", orgId: "org-123", keyId: "key-456", apiVersion: "2026-04-01" });
    mockedAssertOrgMember.mockResolvedValue({ userId: "user-123", orgId: "org-123", role: "member" });

    const request = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "ns_live_sk_test0001" },
    });
    const result = await assertApiKeyOrSession(request);

    expect(result).toEqual({ userId: "user-123", orgId: "org-123" });
    expect(mockedAuthenticateApiKey).toHaveBeenCalledWith(request);
    expect(mockedAssertOrgMember).toHaveBeenCalledWith("user-123", "org-123");
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

  it("AUTH-3: returns 403 when API key owner is no longer an org member", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: "user-123", orgId: "org-123", keyId: "key-456", apiVersion: "2026-04-01" });
    mockedAssertOrgMember.mockRejectedValue(new ForbiddenError("You are not a member of this organization."));

    const request = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "ns_live_sk_test0001" },
    });
    const result = await assertApiKeyOrSession(request);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
    const body = await (result as Response).json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain("no longer a member");
  });

  it("AUTH-3: propagates DB errors from membership check (does not mask as 403)", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: "user-123", orgId: "org-123", keyId: "key-456", apiVersion: "2026-04-01" });
    mockedAssertOrgMember.mockRejectedValue(new Error("connection refused"));

    const request = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "ns_live_sk_test0001" },
    });

    // DB errors should propagate, NOT be caught as 403
    await expect(assertApiKeyOrSession(request)).rejects.toThrow("connection refused");
  });

  it("AUTH-3: verifies org membership for every API key auth, not just first", async () => {
    mockedAuthenticateApiKey.mockResolvedValue({ userId: "user-123", orgId: "org-123", keyId: "key-456", apiVersion: "2026-04-01" });
    // First call: member; second call: removed
    mockedAssertOrgMember
      .mockResolvedValueOnce({ userId: "user-123", orgId: "org-123", role: "member" })
      .mockRejectedValueOnce(new ForbiddenError("You are not a member of this organization."));

    const request1 = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "ns_live_sk_test0001" },
    });
    const result1 = await assertApiKeyOrSession(request1);
    expect(result1).toEqual({ userId: "user-123", orgId: "org-123" });

    const request2 = new Request("http://localhost/api/actions", {
      headers: { "x-nullspend-key": "ns_live_sk_test0001" },
    });
    const result2 = await assertApiKeyOrSession(request2);
    expect(result2).toBeInstanceOf(Response);
    expect((result2 as Response).status).toBe(403);
  });
});
