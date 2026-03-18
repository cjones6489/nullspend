import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertApiKeyWithIdentity,
  resolveDevFallbackApiKeyUserId,
  ApiKeyError,
} from "@/lib/auth/api-key";
import { checkKeyRateLimit } from "@/lib/auth/api-key-rate-limit";

vi.mock("@/lib/auth/api-key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/api-key")>();
  return {
    ...actual,
    assertApiKeyWithIdentity: vi.fn(),
    resolveDevFallbackApiKeyUserId: vi.fn(),
  };
});

vi.mock("@/lib/auth/api-key-rate-limit", () => ({
  checkKeyRateLimit: vi.fn(),
}));

vi.mock("@/lib/observability", () => ({
  getLogger: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("@/lib/observability/request-context", () => ({
  setRequestUserId: vi.fn(),
}));

vi.mock("@/lib/observability/sentry", () => ({
  addSentryBreadcrumb: vi.fn(),
}));

import { setRequestUserId } from "@/lib/observability/request-context";
import { addSentryBreadcrumb } from "@/lib/observability/sentry";
import { authenticateApiKey, applyRateLimitHeaders } from "./with-api-key-auth";

const mockedSetRequestUserId = vi.mocked(setRequestUserId);
const mockedAddSentryBreadcrumb = vi.mocked(addSentryBreadcrumb);

const mockedAssertApiKey = vi.mocked(assertApiKeyWithIdentity);
const mockedResolveDevFallback = vi.mocked(resolveDevFallbackApiKeyUserId);
const mockedCheckKeyRateLimit = vi.mocked(checkKeyRateLimit);

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/actions", {
    method: "POST",
    headers: {
      "x-nullspend-key": "ask_test123",
      "x-request-id": "req-abc-123",
      ...headers,
    },
  });
}

describe("authenticateApiKey", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns ApiKeyAuthContext with rateLimit for managed key identity", async () => {
    const resetTime = Date.now() + 60000;
    mockedAssertApiKey.mockResolvedValue({ userId: "user-123", keyId: "key-456" });
    mockedCheckKeyRateLimit.mockResolvedValue({ allowed: true, limit: 60, remaining: 55, reset: resetTime });

    const result = await authenticateApiKey(makeRequest());

    expect(result).not.toBeInstanceOf(Response);
    const ctx = result as Exclude<typeof result, Response>;
    expect(ctx.userId).toBe("user-123");
    expect(ctx.keyId).toBe("key-456");
    expect(ctx.rateLimit).toEqual({ limit: 60, remaining: 55, reset: resetTime });
    expect(mockedCheckKeyRateLimit).toHaveBeenCalledWith("key-456");
  });

  it("does not include rateLimit for dev fallback (no keyId)", async () => {
    mockedAssertApiKey.mockResolvedValue(null);
    mockedResolveDevFallback.mockReturnValue("dev-user");

    const result = await authenticateApiKey(makeRequest());

    const ctx = result as Exclude<typeof result, Response>;
    expect(ctx.rateLimit).toBeUndefined();
  });

  it("returns ApiKeyAuthContext for dev fallback (keyId: null)", async () => {
    mockedAssertApiKey.mockResolvedValue(null);
    mockedResolveDevFallback.mockReturnValue("dev-user");

    const result = await authenticateApiKey(makeRequest());

    expect(result).toEqual({ userId: "dev-user", keyId: null });
    expect(mockedCheckKeyRateLimit).not.toHaveBeenCalled();
  });

  it("returns 429 Response when rate limit exceeded", async () => {
    const resetTime = Date.now() + 60000;
    mockedAssertApiKey.mockResolvedValue({ userId: "user-123", keyId: "key-456" });
    mockedCheckKeyRateLimit.mockResolvedValue({ allowed: false, limit: 60, remaining: 0, reset: resetTime });

    const result = await authenticateApiKey(makeRequest());

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe("rate_limit_exceeded");
    expect(body.message).toBe("Too many requests");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("429 Response includes x-request-id from request headers", async () => {
    const resetTime = Date.now() + 60000;
    mockedAssertApiKey.mockResolvedValue({ userId: "user-123", keyId: "key-456" });
    mockedCheckKeyRateLimit.mockResolvedValue({ allowed: false, limit: 60, remaining: 0, reset: resetTime });

    const result = await authenticateApiKey(makeRequest());

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("x-request-id")).toBe("req-abc-123");
  });

  it("clamps Retry-After to minimum 1 when reset is in the past", async () => {
    const pastReset = Date.now() - 5000; // 5 seconds ago
    mockedAssertApiKey.mockResolvedValue({ userId: "user-123", keyId: "key-456" });
    mockedCheckKeyRateLimit.mockResolvedValue({ allowed: false, limit: 60, remaining: 0, reset: pastReset });

    const result = await authenticateApiKey(makeRequest());

    expect(result).toBeInstanceOf(Response);
    const retryAfter = (result as Response).headers.get("Retry-After");
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
  });

  it("omits x-request-id header when not present on request", async () => {
    const resetTime = Date.now() + 60000;
    mockedAssertApiKey.mockResolvedValue({ userId: "user-123", keyId: "key-456" });
    mockedCheckKeyRateLimit.mockResolvedValue({ allowed: false, limit: 60, remaining: 0, reset: resetTime });

    // Build request without x-request-id
    const req = new Request("http://localhost/api/actions", {
      method: "POST",
      headers: { "x-nullspend-key": "ask_test123" },
    });
    const result = await authenticateApiKey(req);

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get("x-request-id")).toBeNull();
  });

  it("skips rate limit for dev-mode keys (keyId null)", async () => {
    mockedAssertApiKey.mockResolvedValue(null);
    mockedResolveDevFallback.mockReturnValue("dev-user");

    await authenticateApiKey(makeRequest());

    expect(mockedCheckKeyRateLimit).not.toHaveBeenCalled();
  });

  it("throws ApiKeyError for invalid key", async () => {
    mockedAssertApiKey.mockRejectedValue(new ApiKeyError());

    await expect(authenticateApiKey(makeRequest())).rejects.toThrow(ApiKeyError);
  });

  it("sets request userId and adds breadcrumb for managed key", async () => {
    const resetTime = Date.now() + 60000;
    mockedAssertApiKey.mockResolvedValue({ userId: "user-123", keyId: "key-456" });
    mockedCheckKeyRateLimit.mockResolvedValue({ allowed: true, limit: 60, remaining: 55, reset: resetTime });

    await authenticateApiKey(makeRequest());

    expect(mockedSetRequestUserId).toHaveBeenCalledWith("user-123");
    expect(mockedAddSentryBreadcrumb).toHaveBeenCalledWith(
      "auth", "API key authenticated", { keyId: "key-456", userId: "user-123" },
    );
  });

  it("sets request userId and adds breadcrumb for dev fallback key", async () => {
    mockedAssertApiKey.mockResolvedValue(null);
    mockedResolveDevFallback.mockReturnValue("dev-user");

    await authenticateApiKey(makeRequest());

    expect(mockedSetRequestUserId).toHaveBeenCalledWith("dev-user");
    expect(mockedAddSentryBreadcrumb).toHaveBeenCalledWith(
      "auth", "API key authenticated", { keyId: null, userId: "dev-user" },
    );
  });

  it("does NOT set userId or breadcrumb on rate limit 429", async () => {
    const resetTime = Date.now() + 60000;
    mockedAssertApiKey.mockResolvedValue({ userId: "user-123", keyId: "key-456" });
    mockedCheckKeyRateLimit.mockResolvedValue({ allowed: false, limit: 60, remaining: 0, reset: resetTime });

    const result = await authenticateApiKey(makeRequest());

    expect(result).toBeInstanceOf(Response);
    expect(mockedSetRequestUserId).not.toHaveBeenCalled();
    expect(mockedAddSentryBreadcrumb).not.toHaveBeenCalled();
  });
});

describe("applyRateLimitHeaders", () => {
  it("sets X-RateLimit-* headers when rateLimit is provided", async () => {
    const { NextResponse } = await import("next/server");
    const response = NextResponse.json({ ok: true });
    const result = applyRateLimitHeaders(response, { limit: 60, remaining: 42, reset: 1710000000000 });

    expect(result.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(result.headers.get("X-RateLimit-Remaining")).toBe("42");
    expect(result.headers.get("X-RateLimit-Reset")).toBe("1710000000000");
  });

  it("returns response unchanged when rateLimit is undefined", async () => {
    const { NextResponse } = await import("next/server");
    const response = NextResponse.json({ ok: true });
    const result = applyRateLimitHeaders(response, undefined);

    expect(result.headers.get("X-RateLimit-Limit")).toBeNull();
    expect(result).toBe(response);
  });
});
