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
 * # The exact bug class this test catches
 *
 * The regression we're guarding against is NOT just "the header has a
 * fresh nonce" — the header was ALWAYS fresh. The actual bug was
 * "header fresh + body stale": the middleware set a new nonce on every
 * response, but Vercel's CDN cached the HTML body from a prior request,
 * so the `<script nonce="OLD">` tags baked into the cached body never
 * matched the fresh header nonce. React blocked the script loads and
 * failed to hydrate.
 *
 * To catch THAT bug class, we have to:
 *   1. Read the HTML body (not just headers)
 *   2. Extract the CSP header nonce
 *   3. Parse all `<script nonce="...">` tags from the body
 *   4. Assert body nonces match header nonce (same-response consistency)
 *   5. Fire a second request, assert body nonces differ from first
 *      (body not served from CDN cache)
 *
 * Each test covers a different axis of the bug:
 *   - same-response consistency catches CDN caching the body while the
 *     edge middleware sets a fresh header
 *   - cross-response freshness catches CDN caching the whole response
 *   - cache headers + X-Vercel-Cache catch the directive gap that led
 *     to caching in the first place
 *
 * See:
 *   - proxy.ts:133 (CSP header construction)
 *   - proxy.ts:175 (Cache-Control: private, no-store)
 *   - app/layout.tsx (async layout, calls headers())
 *   - memory/project_session_summary_20260408_launch.md "P0-1 / P0-A2"
 */

import { describe, it, expect } from "vitest";
import { getBaseUrl } from "../lib/env";

// Routes that should carry a fresh CSP nonce on every request. Add HTML
// routes here as new pages are added — the anchor point is "any server-
// rendered page that ships inline scripts or styles with a nonce."
const HTML_ROUTES = [
  "/",       // landing
  "/login",  // auth entry — the exact page broken by P0-1/A2
  "/signup",
  "/docs",   // docs landing (Fumadocs)
];

interface HtmlResponseSnapshot {
  status: number;
  headerNonce: string | null;
  /** All `<script nonce="...">` values found in the response body. */
  bodyScriptNonces: string[];
  /** All `<style nonce="...">` values found in the response body. */
  bodyStyleNonces: string[];
  vercelCache: string | null;
  cacheControl: string | null;
}

/**
 * Fetch a URL and extract nonces from both the CSP header AND the HTML body.
 * Returns a single-request snapshot — critical for same-response
 * consistency checks (the body nonce MUST match the header nonce from
 * the SAME request, not a different one).
 */
async function fetchHtmlSnapshot(url: string): Promise<HtmlResponseSnapshot> {
  const res = await fetch(url, {
    redirect: "manual",
    headers: { accept: "text/html" },
  });

  const csp =
    res.headers.get("content-security-policy") ??
    res.headers.get("content-security-policy-report-only");
  // Nonce format per CSP3: `'nonce-<base64>'`. `proxy.ts` uses
  // `btoa(crypto.randomUUID())` which produces base64 (+ / =). We
  // tolerate base64url too for future-compatibility.
  const headerNonceMatch = csp?.match(/'nonce-([A-Za-z0-9+/=_-]+)'/);
  const headerNonce = headerNonceMatch?.[1] ?? null;

  // Parse body for `<script nonce="..."` and `<style nonce="..."` tags.
  // Only try to parse if the response has a body (skip redirects).
  //
  // Known regex limitations (acceptable because Next.js doesn't emit
  // these patterns and the cost of a real HTML parser would outweigh
  // the benefit for a single E2E test):
  //   - Matches `<script nonce="...">` inside HTML comments:
  //       <!-- <script nonce="fake"> -->
  //   - Matches `<script nonce="...">` inside literal string content of
  //     a parent <script> tag (nested-script edge case).
  //   - Matches inside CDATA, <textarea>, <title>, <pre> content.
  //   - Does not handle multi-line attribute values or HTML5 unquoted
  //     attributes (e.g., `<script nonce=abc>`).
  //
  // If a future content change triggers a false positive on the
  // body-header consistency assertion, switch to a real HTML parser
  // (parse5 or cheerio) rather than extending the regex.
  const bodyScriptNonces: string[] = [];
  const bodyStyleNonces: string[] = [];
  if (res.status >= 200 && res.status < 300) {
    const body = await res.text();
    // Tag attribute regex — tolerates both double and single quoted nonces
    // and arbitrary attribute order before `nonce=`.
    const scriptRe = /<script\b[^>]*\bnonce=["']([A-Za-z0-9+/=_-]+)["']/gi;
    const styleRe = /<style\b[^>]*\bnonce=["']([A-Za-z0-9+/=_-]+)["']/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptRe.exec(body)) !== null) bodyScriptNonces.push(m[1]);
    while ((m = styleRe.exec(body)) !== null) bodyStyleNonces.push(m[1]);
  } else {
    // Consume the body to free the connection even if we don't parse it
    await res.text().catch(() => undefined);
  }

  return {
    status: res.status,
    headerNonce,
    bodyScriptNonces,
    bodyStyleNonces,
    vercelCache: res.headers.get("x-vercel-cache"),
    cacheControl: res.headers.get("cache-control"),
  };
}

describe("CSP nonce freshness (P0-1 / P0-A2 regression)", () => {
  const baseUrl = getBaseUrl();

  describe.each(HTML_ROUTES)("route %s", (route) => {
    it("returns a CSP header with a nonce", async () => {
      const snap = await fetchHtmlSnapshot(`${baseUrl}${route}`);
      expect(snap.status).toBeLessThan(500);
      expect(snap.headerNonce).toBeTruthy();
      expect(snap.headerNonce!.length).toBeGreaterThan(16);
    });

    it("body <script nonce=\"...\"> values match the CSP header nonce (P0-1/A2 core assertion)", async () => {
      const snap = await fetchHtmlSnapshot(`${baseUrl}${route}`);
      // Only enforce body-header consistency on 2xx responses with actual HTML.
      // 3xx redirects have no body nonces to check.
      if (snap.status < 200 || snap.status >= 300) return;

      expect(snap.headerNonce).toBeTruthy();

      // At least ONE script tag with a nonce must be present on a real
      // HTML page. If this regresses to zero, someone removed the nonce
      // propagation in the layout or Next.js stopped stamping scripts.
      expect(
        snap.bodyScriptNonces.length,
        `No <script nonce="..."> tags found in ${route} body. Next.js nonce ` +
          `auto-propagation may be broken. Check app/layout.tsx imports headers().`,
      ).toBeGreaterThan(0);

      // THE core P0-1/A2 check: every body nonce MUST match the header nonce
      // from the SAME response. Body-header mismatch = the CDN served a
      // cached body with a stale nonce baked in.
      for (const bodyNonce of snap.bodyScriptNonces) {
        expect(
          bodyNonce,
          `Body <script nonce="${bodyNonce}"> does not match CSP header ` +
            `nonce "${snap.headerNonce}" on ${route}. This is the exact ` +
            `P0-1/A2 bug class — CDN cached a stale body while the edge ` +
            `middleware set a fresh header nonce.`,
        ).toBe(snap.headerNonce);
      }
      // Same rule for <style nonce> tags (rarer but CSP3 allows them).
      for (const bodyNonce of snap.bodyStyleNonces) {
        expect(bodyNonce).toBe(snap.headerNonce);
      }
    });

    it("returns fresh nonces across back-to-back requests (body-level freshness)", async () => {
      const a = await fetchHtmlSnapshot(`${baseUrl}${route}`);
      // Small delay — just enough that a CDN would serve from cache if it
      // were going to. Real CDN cache TTLs are much longer than this.
      await new Promise((r) => setTimeout(r, 1500));
      const b = await fetchHtmlSnapshot(`${baseUrl}${route}`);

      expect(a.headerNonce).toBeTruthy();
      expect(b.headerNonce).toBeTruthy();
      // Header freshness
      expect(a.headerNonce).not.toBe(b.headerNonce);

      // Body freshness — if there were body nonces in both responses,
      // they must differ. This catches a CDN that re-served the body
      // while edge middleware generated a new header nonce.
      if (a.bodyScriptNonces.length > 0 && b.bodyScriptNonces.length > 0) {
        expect(
          a.bodyScriptNonces[0],
          `Body nonce is the same across back-to-back requests on ${route}. ` +
            `This means the HTML body was served from cache even though the ` +
            `header changed — the P0-1/A2 bug class.`,
        ).not.toBe(b.bodyScriptNonces[0]);
      }
    });

    it("never returns X-Vercel-Cache: HIT on HTML", async () => {
      const snap = await fetchHtmlSnapshot(`${baseUrl}${route}`);
      // HIT means Vercel served from CDN cache — the root cause of P0-1.
      // MISS or null (cache not involved) are both fine.
      if (snap.vercelCache !== null) {
        expect(snap.vercelCache.toUpperCase()).not.toBe("HIT");
      }
    });

    it("sets Cache-Control: no-store on HTML routes", async () => {
      const snap = await fetchHtmlSnapshot(`${baseUrl}${route}`);
      expect(snap.cacheControl?.toLowerCase()).toContain("no-store");
    });
  });
});
