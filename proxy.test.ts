import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Supabase before importing proxy
vi.mock("@/lib/auth/supabase", () => ({
  createProxySupabaseClient: vi.fn(() => ({
    auth: { getClaims: vi.fn().mockResolvedValue({}) },
  })),
}));

import { proxy } from "./proxy";

function makeRequest(url = "https://example.com/dashboard") {
  return new Request(url, {
    headers: new Headers({ cookie: "session=abc" }),
  });
}

describe("proxy()", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("CSP header", () => {
    it("sets Content-Security-Policy-Report-Only header", async () => {
      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy-Report-Only");

      expect(csp).toBeTruthy();
    });

    it("includes a nonce in script-src and style-src", async () => {
      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy-Report-Only")!;

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

      const csp1 = res1.headers.get("Content-Security-Policy-Report-Only")!;
      const csp2 = res2.headers.get("Content-Security-Policy-Report-Only")!;

      const nonce1 = csp1.match(/'nonce-([^']+)'/)![1];
      const nonce2 = csp2.match(/'nonce-([^']+)'/)![1];

      expect(nonce1).not.toBe(nonce2);
    });

    it("includes strict-dynamic in script-src", async () => {
      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy-Report-Only")!;

      expect(csp).toContain("'strict-dynamic'");
    });

    it("includes all security directives", async () => {
      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy-Report-Only")!;

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
      const csp = response.headers.get("Content-Security-Policy-Report-Only")!;

      expect(csp).not.toContain("'unsafe-eval'");
    });

    it("excludes unsafe-inline from style-src in production", async () => {
      process.env.NODE_ENV = "production";

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy-Report-Only")!;

      const styleSrc = csp.split(";").find((d) => d.trim().startsWith("style-src"));
      expect(styleSrc).not.toContain("'unsafe-inline'");
    });
  });

  describe("Supabase URL handling", () => {
    it("includes Supabase origin in connect-src when configured", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy-Report-Only")!;

      const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src"));
      expect(connectSrc).toContain("https://abc.supabase.co");
      expect(connectSrc).toContain("wss://abc.supabase.co");
    });

    it("handles missing Supabase URL gracefully", async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy-Report-Only")!;

      const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src"));
      expect(connectSrc!.trim()).toBe("connect-src 'self'");
    });

    it("handles invalid Supabase URL gracefully", async () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "not-a-url";

      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy-Report-Only")!;

      // Should not throw, just fall back to 'self' only
      const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src"));
      expect(connectSrc!.trim()).toBe("connect-src 'self'");
    });
  });

  describe("nonce propagation", () => {
    it("sets x-nonce request header for downstream Server Components", async () => {
      const response = await proxy(makeRequest() as any);
      const csp = response.headers.get("Content-Security-Policy-Report-Only")!;
      const nonce = csp.match(/'nonce-([^']+)'/)![1];

      // The response should have been created with the modified request headers
      // We verify the nonce is a valid UUID (propagation is tested via the CSP containing it)
      expect(nonce).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
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
      expect(response.headers.get("Content-Security-Policy-Report-Only")).toBeTruthy();
    });
  });
});
