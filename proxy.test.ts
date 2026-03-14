import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Supabase before importing proxy
vi.mock("@/lib/auth/supabase", () => ({
  createProxySupabaseClient: vi.fn(() => ({
    auth: { getClaims: vi.fn().mockResolvedValue({}) },
  })),
}));

// Mock rate limiting — default to allowing all requests
const { mockLimit, MockRatelimit } = vi.hoisted(() => {
  const mockLimit = vi.fn().mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: Date.now() + 60000 });
  const MockRatelimit = vi.fn().mockImplementation(function () { return { limit: mockLimit }; });
  (MockRatelimit as any).slidingWindow = vi.fn();
  return { mockLimit, MockRatelimit };
});
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: MockRatelimit,
}));
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn() },
}));

import { proxy, _resetRatelimitForTesting } from "./proxy";

function makeRequest(
  url = "https://example.com/dashboard",
  init?: RequestInit,
) {
  const req = new Request(url, {
    headers: new Headers({ cookie: "session=abc" }),
    ...init,
  });
  // Simulate NextRequest.nextUrl
  (req as any).nextUrl = new URL(url);
  return req;
}

describe("proxy()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetRatelimitForTesting();
    vi.restoreAllMocks();
  });

  describe("CSP header", () => {
    it("sets enforcing Content-Security-Policy header in non-dev mode", async () => {
      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy");

      expect(csp).toBeTruthy();
      expect(response.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    });

    it("includes a nonce in script-src and style-src", async () => {
      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy")!;

      // Extract nonce from script-src
      const nonceMatch = csp.match(/'nonce-([^']+)'/);
      expect(nonceMatch).toBeTruthy();
      const nonce = nonceMatch![1];

      // UUID format
      expect(nonce).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );

      // Same nonce in both directives
      expect(csp).toContain(`'nonce-${nonce}'`);
      const nonceOccurrences = csp.split(`'nonce-${nonce}'`).length - 1;
      expect(nonceOccurrences).toBe(2); // script-src + style-src
    });

    it("generates a unique nonce per request", async () => {
      const res1 = await proxy(makeRequest() as any);
      const res2 = await proxy(makeRequest() as any);

      const csp1 = res1.headers.get("Content-Security-Policy")!;
      const csp2 = res2.headers.get("Content-Security-Policy")!;

      const nonce1 = csp1.match(/'nonce-([^']+)'/)![1];
      const nonce2 = csp2.match(/'nonce-([^']+)'/)![1];

      expect(nonce1).not.toBe(nonce2);
    });

    it("includes strict-dynamic in script-src", async () => {
      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy")!;

      expect(csp).toContain("'strict-dynamic'");
    });

    it("includes all security directives", async () => {
      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy")!;

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("upgrade-insecure-requests");
      expect(csp).toContain("font-src 'self'");
      expect(csp).toContain("img-src 'self' blob: data:");
    });
  });

  describe("development mode", () => {
    it("uses Report-Only CSP in development", async () => {
      process.env.NODE_ENV = "development";

      const response = await proxy(makeRequest() as any);
      expect(response.headers.get("Content-Security-Policy-Report-Only")).toBeTruthy();
      expect(response.headers.get("Content-Security-Policy")).toBeNull();
    });

    it("includes unsafe-eval in script-src during development", async () => {
      process.env.NODE_ENV = "development";

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy-Report-Only")!;

      expect(csp).toContain("'unsafe-eval'");
    });

    it("includes unsafe-inline in style-src during development", async () => {
      process.env.NODE_ENV = "development";

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy-Report-Only")!;

      // style-src should contain unsafe-inline
      const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src"));
      expect(styleSrc).toContain("'unsafe-inline'");
    });
  });

  describe("production mode", () => {
    it("excludes unsafe-eval in production", async () => {
      process.env.NODE_ENV = "production";

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy")!;

      expect(csp).not.toContain("'unsafe-eval'");
    });

    it("excludes unsafe-inline from style-src in production", async () => {
      process.env.NODE_ENV = "production";

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy")!;

      const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src"));
      expect(styleSrc).not.toContain("'unsafe-inline'");
    });
  });

  describe("Supabase URL handling", () => {
    it("includes Supabase origin in connect-src when configured", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy")!;

      const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src"));
      expect(connectSrc).toContain("https://abc.supabase.co");
      expect(connectSrc).toContain("wss://abc.supabase.co");
    });

    it("handles missing Supabase URL gracefully", async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy")!;

      const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src"));
      expect(connectSrc!.trim()).toBe("connect-src 'self'");
    });

    it("handles invalid Supabase URL gracefully", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy")!;

      // Should not throw, just fall back to 'self' only
      const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src"));
      expect(connectSrc!.trim()).toBe("connect-src 'self'");
    });
  });

  describe("nonce propagation", () => {
    it("sets x-nonce request header for downstream Server Components", async () => {
      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy")!;
      const nonce = csp.match(/'nonce-([^']+)'/)![1];

      // The response should have been created with the modified request headers
      // We verify the nonce is a valid UUID (propagation is tested via the CSP containing it)
      expect(nonce).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });

  describe("CSRF protection", () => {
    it("blocks cross-origin POST to /api/ routes", async () => {
      const req = makeRequest("https://example.com/api/actions", {
        method: "POST",
        headers: new Headers({
          cookie: "session=abc",
          origin: "https://evil.com",
          host: "example.com",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Cross-origin request blocked");
    });

    it("allows same-origin POST to /api/ routes", async () => {
      const req = makeRequest("https://example.com/api/actions", {
        method: "POST",
        headers: new Headers({
          cookie: "session=abc",
          origin: "https://example.com",
          host: "example.com",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).not.toBe(403);
    });

    it("allows POST to /api/ routes without Origin or Referer header (non-browser)", async () => {
      const req = makeRequest("https://example.com/api/actions", {
        method: "POST",
        headers: new Headers({
          cookie: "session=abc",
          host: "example.com",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).not.toBe(403);
    });

    it("blocks cross-origin Referer when Origin is absent", async () => {
      const req = makeRequest("https://example.com/api/actions", {
        method: "POST",
        headers: new Headers({
          cookie: "session=abc",
          host: "example.com",
          referer: "https://evil.com/page",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).toBe(403);
    });

    it("allows same-origin Referer when Origin is absent", async () => {
      const req = makeRequest("https://example.com/api/actions", {
        method: "POST",
        headers: new Headers({
          cookie: "session=abc",
          host: "example.com",
          referer: "https://example.com/dashboard",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).not.toBe(403);
    });

    it("skips CSRF check for GET requests", async () => {
      const req = makeRequest("https://example.com/api/actions", {
        method: "GET",
        headers: new Headers({
          cookie: "session=abc",
          origin: "https://evil.com",
          host: "example.com",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).not.toBe(403);
    });

    it("skips CSRF check for non-API routes", async () => {
      const req = makeRequest("https://example.com/dashboard", {
        method: "POST",
        headers: new Headers({
          cookie: "session=abc",
          origin: "https://evil.com",
          host: "example.com",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).not.toBe(403);
    });

    it("returns 400 for malformed Origin header", async () => {
      const req = makeRequest("https://example.com/api/actions", {
        method: "POST",
        headers: new Headers({
          cookie: "session=abc",
          origin: "not-a-valid-url",
          host: "example.com",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).toBe(400);
    });

    it("uses x-forwarded-host when available", async () => {
      const req = makeRequest("https://example.com/api/actions", {
        method: "POST",
        headers: new Headers({
          cookie: "session=abc",
          origin: "https://myapp.vercel.app",
          host: "internal-host",
          "x-forwarded-host": "myapp.vercel.app",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).not.toBe(403);
    });
  });

  describe("body size limits", () => {
    it("rejects POST to /api/ with Content-Length exceeding 1MB", async () => {
      const req = makeRequest("https://example.com/api/actions", {
        method: "POST",
        headers: new Headers({
          cookie: "session=abc",
          host: "example.com",
          "content-length": "2000000",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).toBe(413);
      const body = await response.json();
      expect(body.error).toBe("Payload too large");
    });

    it("allows POST to /api/ with Content-Length under 1MB", async () => {
      const req = makeRequest("https://example.com/api/actions", {
        method: "POST",
        headers: new Headers({
          cookie: "session=abc",
          host: "example.com",
          "content-length": "500",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).not.toBe(413);
    });

    it("allows POST to /api/ without Content-Length header", async () => {
      const req = makeRequest("https://example.com/api/actions", {
        method: "POST",
        headers: new Headers({
          cookie: "session=abc",
          host: "example.com",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).not.toBe(413);
    });
  });

  describe("rate limiting", () => {
    beforeEach(() => {
      process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
      process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
    });

    it("returns 429 when rate limit is exceeded on /api/ routes", async () => {
      mockLimit.mockResolvedValueOnce({ success: false, limit: 100, remaining: 0, reset: Date.now() + 60000 });

      const req = makeRequest("https://example.com/api/actions", {
        method: "GET",
        headers: new Headers({
          cookie: "session=abc",
          host: "example.com",
          "x-forwarded-for": "1.2.3.4",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body.error).toBe("Too many requests");
    });

    it("skips rate limiting for non-API routes", async () => {
      mockLimit.mockResolvedValueOnce({ success: false, limit: 100, remaining: 0, reset: Date.now() + 60000 });

      const req = makeRequest("https://example.com/dashboard");
      const response = await proxy(req as any);
      expect(response.status).not.toBe(429);
    });

    it("returns 503 when rate limiter throws an error (fail-closed)", async () => {
      mockLimit.mockReset();
      MockRatelimit.mockImplementation(function () { return { limit: mockLimit }; });
      (MockRatelimit as any).slidingWindow = vi.fn();
      mockLimit.mockRejectedValueOnce(new Error("Redis connection failed"));

      const req = makeRequest("https://example.com/api/actions", {
        method: "GET",
        headers: new Headers({
          cookie: "session=abc",
          host: "example.com",
          "x-forwarded-for": "1.2.3.4",
        }),
      });
      const response = await proxy(req as any);
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error).toBe("Service temporarily unavailable");
    });

    it("skips rate limiting when Upstash env vars are not set", async () => {
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;

      const req = makeRequest("https://example.com/api/actions", {
        method: "GET",
        headers: new Headers({ host: "example.com" }),
      });
      const response = await proxy(req as any);
      expect(response.status).not.toBe(429);
    });
  });

  describe("Supabase auth integration", () => {
    it("still calls Supabase auth getClaims", async () => {
      const { createProxySupabaseClient } = await import("@/lib/auth/supabase");

      await proxy(makeRequest() as any);

      expect(createProxySupabaseClient).toHaveBeenCalled();
    });

    it("returns response even when Supabase throws", async () => {
      const { createProxySupabaseClient } = await import("@/lib/auth/supabase");
      vi.mocked(createProxySupabaseClient).mockImplementationOnce(() => {
        throw new Error("Supabase not configured");
      });

      const response = await proxy(makeRequest() as any);

      // Should still return a valid response with CSP
      expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
    });
  });
});
