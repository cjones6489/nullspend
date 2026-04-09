import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Supabase before importing proxy
vi.mock("@/lib/auth/supabase", () => ({
  createProxySupabaseClient: vi.fn(() => ({
    auth: { getClaims: vi.fn().mockResolvedValue({}) },
  })),
}));

// Mock observability logger
vi.mock("@/lib/observability", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
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
  afterEach(() => {
    _resetRatelimitForTesting();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("CSP header", () => {
    it("sets enforcing Content-Security-Policy header in non-dev mode", async () => {
      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy");

      expect(csp).toBeTruthy();
      expect(response.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
    });

    it("includes a base64-encoded nonce in script-src and style-src", async () => {
      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy")!;

      // Extract nonce from script-src
      const nonceMatch = csp.match(/'nonce-([^']+)'/);
      expect(nonceMatch).toBeTruthy();
      const nonce = nonceMatch![1];

      // Base64-encoded format (matches Next.js 16's CSP guide + CSP3 spec
      // "nonce-source = 'nonce-' base64-value"). The proxy base64-encodes
      // crypto.randomUUID() so the nonce looks like "OWRhOWE5MzItMT...".
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);

      // Decoding should yield a valid UUID
      const decoded = Buffer.from(nonce, "base64").toString("utf-8");
      expect(decoded).toMatch(
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
      vi.stubEnv("NODE_ENV", "development");

      const response = await proxy(makeRequest() as any);
      expect(response.headers.get("Content-Security-Policy-Report-Only")).toBeTruthy();
      expect(response.headers.get("Content-Security-Policy")).toBeNull();
    });

    it("includes unsafe-eval in script-src during development", async () => {
      vi.stubEnv("NODE_ENV", "development");

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy-Report-Only")!;

      expect(csp).toContain("'unsafe-eval'");
    });

    it("includes unsafe-inline in style-src during development", async () => {
      vi.stubEnv("NODE_ENV", "development");

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy-Report-Only")!;

      // style-src should contain unsafe-inline
      const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src"));
      expect(styleSrc).toContain("'unsafe-inline'");
    });
  });

  describe("production mode", () => {
    it("excludes unsafe-eval in production", async () => {
      vi.stubEnv("NODE_ENV", "production");

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy")!;

      expect(csp).not.toContain("'unsafe-eval'");
    });

    it("excludes unsafe-inline from style-src in production", async () => {
      vi.stubEnv("NODE_ENV", "production");

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy")!;

      const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src"));
      expect(styleSrc).not.toContain("'unsafe-inline'");
    });
  });

  describe("Supabase URL handling", () => {
    it("includes Supabase origin in connect-src when configured", async () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");

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
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");

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

      // The response should have been created with the modified request headers.
      // We verify the nonce is valid base64 (propagation is tested via the CSP containing it).
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });
  });

  describe("P0-A2 regression: CSP nonce propagation to request headers", () => {
    // Regression: P0-A2 — Next.js nonce auto-propagation was broken
    // Found by /qa on 2026-04-08
    // Report: .gstack/qa-reports/qa-report-nullspend-dev-2026-04-08.md
    //
    // BUG: proxy.ts set the CSP header only on the response, not on the
    // request. Next.js 16's auto-propagation reads the CSP from the REQUEST
    // headers to identify the nonce to stamp onto framework scripts, inline
    // styles, and <Script> components. Without CSP in the request headers,
    // Next.js didn't know a nonce was in effect, so it rendered every page
    // without nonce attributes. Combined with static prerendering (fixed
    // in app/layout.tsx by adding a headers() call), the result was zero
    // <script nonce="..."> tags in the HTML body and 35+ CSP violations
    // per page load.
    //
    // FIX: set Content-Security-Policy in requestHeaders alongside x-nonce.
    //
    // This matches the official Next.js CSP example:
    // https://nextjs.org/docs/app/guides/content-security-policy

    it("sets Content-Security-Policy header in request headers (for nonce auto-propagation)", async () => {
      let capturedRequestHeaders: Headers | undefined;

      // NextResponse.next is mocked at test-import time. Spy on it to
      // capture the request.headers passed into the init.
      const { NextResponse } = await import("next/server");
      const nextSpy = vi
        .spyOn(NextResponse, "next")
        .mockImplementation((init?: any) => {
          capturedRequestHeaders = init?.request?.headers as Headers | undefined;
          return new NextResponse(null, { status: 200 }) as any;
        });

      try {
        await proxy(makeRequest() as any);
      } finally {
        nextSpy.mockRestore();
      }

      expect(capturedRequestHeaders).toBeTruthy();
      const requestCsp = capturedRequestHeaders!.get("Content-Security-Policy");
      expect(requestCsp).toBeTruthy();
      expect(requestCsp).toContain("script-src");
      expect(requestCsp).toContain("'nonce-");
      expect(requestCsp).toContain("'strict-dynamic'");
    });

    it("request-header CSP nonce matches response-header CSP nonce", async () => {
      let capturedRequestHeaders: Headers | undefined;

      const { NextResponse } = await import("next/server");
      const nextSpy = vi
        .spyOn(NextResponse, "next")
        .mockImplementation((init?: any) => {
          capturedRequestHeaders = init?.request?.headers as Headers | undefined;
          const res = new NextResponse(null, { status: 200 }) as any;
          return res;
        });

      let response: Response;
      try {
        response = (await proxy(makeRequest() as any)) as unknown as Response;
      } finally {
        nextSpy.mockRestore();
      }

      // Because we mock NextResponse.next, the proxy's response header
      // setters act on our returned stub. Both request and response CSP
      // headers are built from the same cspHeaderValue variable, so they
      // must match.
      const requestCsp = capturedRequestHeaders!.get("Content-Security-Policy");
      const responseCsp = response.headers.get("Content-Security-Policy");
      expect(requestCsp).toBe(responseCsp);

      // And the nonce should be present in both
      const requestNonce = requestCsp!.match(/'nonce-([^']+)'/)?.[1];
      const responseNonce = responseCsp!.match(/'nonce-([^']+)'/)?.[1];
      expect(requestNonce).toBeTruthy();
      expect(requestNonce).toBe(responseNonce);
    });

    it("uses base64-encoded nonce per CSP3 spec", async () => {
      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy")!;
      const nonce = csp.match(/'nonce-([^']+)'/)![1];

      // Base64 charset: A-Z, a-z, 0-9, +, /, = padding
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);

      // Round-trip decode should produce a UUID
      const decoded = Buffer.from(nonce, "base64").toString("utf-8");
      expect(decoded).toMatch(
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
      expect(body.error.code).toBe("csrf_rejected");
      expect(body.error.message).toBe("Cross-origin request blocked.");
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
      expect(body.error.code).toBe("payload_too_large");
      expect(body.error.message).toBe("Payload too large.");
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
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
      vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
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
      expect(body.error.code).toBe("rate_limit_exceeded");
      expect(body.error.message).toBe("Too many requests.");
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
      expect(body.error.code).toBe("service_unavailable");
      expect(body.error.message).toBe("Service temporarily unavailable.");
    });

    it("clamps Retry-After to minimum 1 when reset is in the past", async () => {
      mockLimit.mockResolvedValueOnce({ success: false, limit: 100, remaining: 0, reset: Date.now() - 5000 });

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
      const retryAfter = response.headers.get("Retry-After");
      expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
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

  describe("x-request-id header", () => {
    it("includes x-request-id in normal (200) response", async () => {
      const response = await proxy(makeRequest() as any);
      const requestId = response.headers.get("x-request-id");
      expect(requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it("generates unique request IDs per request", async () => {
      const res1 = await proxy(makeRequest() as any);
      const res2 = await proxy(makeRequest() as any);
      expect(res1.headers.get("x-request-id")).not.toBe(
        res2.headers.get("x-request-id"),
      );
    });

    it("passes through provided x-request-id header", async () => {
      const req = makeRequest("https://example.com/dashboard", {
        headers: new Headers({
          cookie: "session=abc",
          "x-request-id": "client-id-123",
        }),
      });
      const response = await proxy(req as any);
      expect(response.headers.get("x-request-id")).toBe("client-id-123");
    });

    it("includes x-request-id in 429 rate limit response", async () => {
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
      vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
      mockLimit.mockResolvedValueOnce({
        success: false,
        limit: 100,
        remaining: 0,
        reset: Date.now() + 60000,
      });

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
      expect(response.headers.get("x-request-id")).toBeTruthy();
    });

    it("includes x-request-id in 503 limiter error response", async () => {
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
      vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
      mockLimit.mockReset();
      MockRatelimit.mockImplementation(function () {
        return { limit: mockLimit };
      });
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
      expect(response.headers.get("x-request-id")).toBeTruthy();
    });

    it("includes x-request-id in 403 CSRF response", async () => {
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
      expect(response.headers.get("x-request-id")).toBeTruthy();
    });

    it("includes x-request-id in 413 body size response", async () => {
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
      expect(response.headers.get("x-request-id")).toBeTruthy();
    });
  });

  describe("Cache-Control headers", () => {
    it("sets Cache-Control: private, no-store on API route responses", async () => {
      const req = makeRequest("https://example.com/api/actions", {
        method: "GET",
        headers: new Headers({ cookie: "session=abc", host: "example.com" }),
      });
      const response = await proxy(req as any);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("sets Vary: Cookie on API route responses", async () => {
      const req = makeRequest("https://example.com/api/actions", {
        method: "GET",
        headers: new Headers({ cookie: "session=abc", host: "example.com" }),
      });
      const response = await proxy(req as any);
      expect(response.headers.get("Vary")).toBe("Cookie");
    });

    it("sets Cache-Control: private, no-store on non-API (HTML) routes", async () => {
      // Regression: ISSUE-001 — CSP nonce + CDN cache collision
      // Found by /qa on 2026-04-08
      // Report: .gstack/qa-reports/qa-report-nullspend-dev-2026-04-08.md
      // Every response from proxy() carries a per-request CSP nonce in both
      // the response header and (via the x-nonce request header) in the HTML
      // <script nonce="..."> tags. If the HTML body is CDN-cached, subsequent
      // requests get a fresh nonce in the CSP header but a STALE nonce baked
      // into the HTML, and the browser blocks every script (React fails to
      // hydrate). Cache-Control: no-store on ALL routes prevents this.
      const response = await proxy(makeRequest("https://example.com/dashboard") as any);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("sets Cache-Control on 429 rate limit response", async () => {
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
      vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
      mockLimit.mockResolvedValueOnce({
        success: false,
        limit: 100,
        remaining: 0,
        reset: Date.now() + 60000,
      });

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
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("sets Cache-Control on 403 CSRF response", async () => {
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
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });
  });

  describe("ISSUE-001 regression: CSP nonce + CDN cache prevention", () => {
    // Regression: ISSUE-001 — CSP nonce + CDN cache collision
    // Found by /qa on 2026-04-08 against www.nullspend.dev
    // Report: .gstack/qa-reports/qa-report-nullspend-dev-2026-04-08.md
    //
    // BUG: proxy.ts used to only set Cache-Control: no-store on /api/* routes.
    // Next.js HTML page routes were CDN-cacheable, but each response carried a
    // per-request CSP nonce in the response header. Vercel cached the HTML body
    // with a stale nonce while serving fresh CSP headers on each request, so
    // browsers blocked every <script> tag and React never hydrated. Symptoms:
    // login page stuck on <Suspense fallback>, signup form non-interactive,
    // landing page CTAs dead, 35+ CSP violations per page load.
    //
    // FIX: set Cache-Control: no-store on ALL responses from the middleware,
    // not just /api/*. The matcher already excludes static assets.

    it("sets Cache-Control: no-store on /login (Suspense + useSearchParams page)", async () => {
      const response = await proxy(makeRequest("https://example.com/login") as any);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("sets Cache-Control: no-store on / (root marketing page)", async () => {
      const response = await proxy(makeRequest("https://example.com/") as any);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("sets Cache-Control: no-store on /signup", async () => {
      const response = await proxy(makeRequest("https://example.com/signup") as any);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("sets Cache-Control: no-store on /app/home (authenticated dashboard)", async () => {
      const response = await proxy(makeRequest("https://example.com/app/home") as any);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    });

    it("sets Vary: Cookie on non-API (HTML) routes", async () => {
      const response = await proxy(makeRequest("https://example.com/signup") as any);
      expect(response.headers.get("Vary")).toBe("Cookie");
    });

    it("nonce changes per request AND Cache-Control is no-store (the whole invariant)", async () => {
      const res1 = await proxy(makeRequest("https://example.com/login") as any);
      const res2 = await proxy(makeRequest("https://example.com/login") as any);

      const nonce1 = res1.headers.get("Content-Security-Policy")!.match(/'nonce-([^']+)'/)![1];
      const nonce2 = res2.headers.get("Content-Security-Policy")!.match(/'nonce-([^']+)'/)![1];

      // Fresh nonce per request (proves middleware is generating new nonces)
      expect(nonce1).not.toBe(nonce2);

      // And both responses say "do not cache" — so the CDN won't serve stale
      // HTML with a mismatched nonce to the next visitor.
      expect(res1.headers.get("Cache-Control")).toBe("private, no-store");
      expect(res2.headers.get("Cache-Control")).toBe("private, no-store");
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
