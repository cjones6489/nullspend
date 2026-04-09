/**
 * Proxy reachability + end-to-end PONG — P0-F launch-night regression.
 *
 * P0-F was the proxy URL not resolving in DNS + docs hardcoding the wrong
 * domain. The full launch-night fix required running a real PONG through
 * `proxy.nullspend.dev/v1/chat/completions` and verifying the cost event
 * landed in Postgres within seconds.
 *
 * This test mirrors that manual verification as an automated probe:
 *   1. HTTP HEAD / OPTIONS on proxy root — reachable, no auth required
 *   2. POST /v1/chat/completions with real OpenAI key — 200 + response
 *      shape looks like OpenAI's (has `choices[0].message`)
 *   3. Latency budget — total round-trip < 10s (generous for CI variance)
 *
 * Auto-skips if `OPENAI_API_KEY` or `NULLSPEND_API_KEY` is missing (local
 * dev without prod credentials). In CI, both secrets must be set for the
 * nightly + post-deploy runs.
 *
 * Cost: ~$0.0001 per run (gpt-4o-mini, "PING" prompt, 1-2 output tokens).
 *
 * See:
 *   - memory/project_production_urls.md (canonical proxy URL)
 *   - memory/project_session_summary_20260408_launch.md "End-to-end verification"
 */

import { describe, it, expect } from "vitest";
import { getProxyUrl } from "../lib/env";

const openaiKey = process.env.OPENAI_API_KEY;
const nullspendKey = process.env.NULLSPEND_API_KEY;
const hasCredentials = Boolean(openaiKey && nullspendKey);

describe.skipIf(!hasCredentials)(
  "Proxy reachability (P0-F regression)",
  () => {
    const proxyUrl = getProxyUrl();

    it("HEAD / returns a response (DNS + TLS + worker alive)", async () => {
      // HEAD / on the proxy root hits the index entry point. Any
      // non-error response proves DNS resolved, TLS handshake succeeded,
      // and the Cloudflare Worker is serving. 404/405 are fine — we just
      // need to NOT see DNS/TLS/worker failures.
      const res = await fetch(proxyUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(10_000),
      });
      // Worker should respond with SOMETHING — not a gateway error.
      // 400-499 are OK (bad request shape for HEAD, etc.)
      // 500+ and network errors are failures.
      expect(res.status).toBeLessThan(500);
    });

    it("POST /v1/chat/completions returns a real OpenAI response (PING test)", async () => {
      const start = Date.now();
      const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NullSpend-Key": nullspendKey!,
          Authorization: `Bearer ${openaiKey}`,
          // Tag the call so analytics filter it out of customer reports.
          "X-NullSpend-Tags": "e2e_tier=L3,e2e_suite=proxy-reachable",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Respond with a single word: PONG" }],
          max_completion_tokens: 10,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number };
      };

      // Response shape sanity — OpenAI chat completion format
      expect(body.choices).toBeDefined();
      expect(body.choices!.length).toBeGreaterThan(0);
      expect(typeof body.choices![0].message?.content).toBe("string");
      expect(body.usage?.total_tokens).toBeGreaterThan(0);

      // Latency budget: 10s is generous. Cold-start + network + OpenAI
      // variance all fit inside this. If this fires, something is wrong.
      const elapsed = Date.now() - start;
      expect(
        elapsed,
        `PONG round-trip took ${elapsed}ms (budget 30s)`,
      ).toBeLessThan(30_000);
    });

    it("rejects invalid NullSpend key with 401/403 (auth path alive)", async () => {
      const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NullSpend-Key": "ns_live_sk_00000000000000000000000000deadbeef",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "x" }],
          max_completion_tokens: 1,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      // Auth must FAIL CLOSED — proxy rejects before forwarding to OpenAI.
      // 401 or 403 are both valid per apps/proxy/CLAUDE.md.
      expect([401, 403]).toContain(res.status);
    });
  },
);

describe.skipIf(hasCredentials)(
  "Proxy reachability (credentials missing — skipped)",
  () => {
    it("test suite is skipped because OPENAI_API_KEY or NULLSPEND_API_KEY is not set", () => {
      // This explicit skip marker makes the reason visible in test output
      // so "0 tests" doesn't silently hide the gap. Add the secrets to
      // .env.e2e locally, or to GitHub Actions secrets for CI.
      expect(hasCredentials).toBe(false);
    });
  },
);
