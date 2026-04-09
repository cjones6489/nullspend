/**
 * CSP nonce freshness regression — P0-1 / P0-A2 from 2026-04-08 launch night.
 *
 * The original bug: Vercel CDN cached `/login` HTML with a stale CSP nonce
 * while the response header carried a fresh one on each request. CSP blocked
 * every `<script nonce="OLD">` → React never hydrated → login page rendered
 * no form fields.
 *
 * The fix: `proxy.ts` sets `Cache-Control: private, no-store` on every
 * response + the root layout calls `headers()` to force dynamic rendering.
 *
 * This test catches any regression by verifying:
 *   1. HTML routes return a CSP header with a nonce
 *   2. Back-to-back requests return DIFFERENT nonces (no CDN caching)
 *   3. `X-Vercel-Cache` is never `HIT` on HTML routes
 *   4. `Cache-Control` always contains `no-store`
 *
 * See:
 *   - proxy.ts:133 (CSP header construction)
 *   - proxy.ts:175 (Cache-Control: private, no-store)
 *   - app/layout.tsx (async layout, calls headers())
 *   - memory/project_session_summary_20260408_launch.md "P0-1 / P0-A2"
 */

import { describe, it, expect } from "vitest";
import { getBaseUrl } from "../lib/env";

const unreachable = process.env.E2E_TARGET_UNREACHABLE === "1";

// Routes that should carry a fresh CSP nonce on every request. Add HTML
// routes here as new pages are added — the anchor point is "any server-
// rendered page that ships inline scripts or styles with a nonce."
const HTML_ROUTES = [
  "/",       // landing
  "/login",  // auth entry — the exact page broken by P0-1/A2
  "/signup",
  "/docs",   // docs landing (Fumadocs)
];

interface HtmlResponseHeaders {
  nonce: string | null;
  vercelCache: string | null;
  cacheControl: string | null;
  status: number;
}

async function fetchHtmlHeaders(url: string): Promise<HtmlResponseHeaders> {
  const res = await fetch(url, {
    redirect: "manual",
    headers: { accept: "text/html" },
  });
  const csp =
    res.headers.get("content-security-policy") ??
    res.headers.get("content-security-policy-report-only");
  // Nonce format: `'nonce-<base64>'` per CSP3 spec.
  // proxy.ts uses `btoa(crypto.randomUUID())` which produces base64 with
  // `/+=` characters. Pattern tolerates all valid base64 chars.
  const nonceMatch = csp?.match(/'nonce-([A-Za-z0-9+/=_-]+)'/);
  return {
    nonce: nonceMatch?.[1] ?? null,
    vercelCache: res.headers.get("x-vercel-cache"),
    cacheControl: res.headers.get("cache-control"),
    status: res.status,
  };
}

describe.skipIf(unreachable)("CSP nonce freshness (P0-1 / P0-A2 regression)", () => {
  const baseUrl = getBaseUrl();

  describe.each(HTML_ROUTES)("route %s", (route) => {
    it("returns a CSP header with a nonce", async () => {
      const headers = await fetchHtmlHeaders(`${baseUrl}${route}`);
      // Accept 200 and 3xx redirects — both are valid server-rendered paths
      expect(headers.status).toBeLessThan(500);
      expect(headers.nonce).toBeTruthy();
      expect(headers.nonce!.length).toBeGreaterThan(16);
    });

    it("returns a different nonce on back-to-back requests (no CDN caching)", async () => {
      const a = await fetchHtmlHeaders(`${baseUrl}${route}`);
      // Small delay — just enough that a CDN would serve from cache if it
      // were going to. Real CDN cache TTLs are much longer than this.
      await new Promise((r) => setTimeout(r, 1500));
      const b = await fetchHtmlHeaders(`${baseUrl}${route}`);

      expect(a.nonce).toBeTruthy();
      expect(b.nonce).toBeTruthy();
      expect(a.nonce).not.toBe(b.nonce);
    });

    it("never returns X-Vercel-Cache: HIT on HTML", async () => {
      const headers = await fetchHtmlHeaders(`${baseUrl}${route}`);
      // HIT means Vercel served from CDN cache — the root cause of P0-1.
      // MISS or null (cache not involved) are both fine.
      if (headers.vercelCache !== null) {
        expect(headers.vercelCache.toUpperCase()).not.toBe("HIT");
      }
    });

    it("sets Cache-Control: no-store on HTML routes", async () => {
      const headers = await fetchHtmlHeaders(`${baseUrl}${route}`);
      expect(headers.cacheControl?.toLowerCase()).toContain("no-store");
    });
  });
});
