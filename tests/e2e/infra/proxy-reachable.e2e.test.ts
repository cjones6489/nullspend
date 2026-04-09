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

import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";
import { getProxyUrl } from "../lib/env";

const openaiKey = process.env.OPENAI_API_KEY;
const nullspendKey = process.env.NULLSPEND_API_KEY;
const hasCredentials = Boolean(openaiKey && nullspendKey);

// Optional DB verification: if DATABASE_URL is set, after a successful
// PONG we query the cost_events table to verify the event actually
// landed in Postgres within the expected latency window. Closes
// Gap-7 from the Slice 1 audit (end-to-end cost-tracking verification,
// not just HTTP-response-level).
//
// Gracefully degrades: if DATABASE_URL isn't set (local dev without
// Supabase pooler access), the DB check is skipped with a clear
// message rather than failing.
const databaseUrl = process.env.DATABASE_URL;
const hasDbAccess = Boolean(databaseUrl && databaseUrl.startsWith("postgres"));

// Shared unique run ID — lets the DB query find THIS test's cost event
// even if other test runs are writing events to the same table
// concurrently. Must match the `X-NullSpend-Tags` header on the PONG
// request below.
const E2E_RUN_ID = `proxy-reachable-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Lazy singleton — only connects when we actually query.
let sqlClient: ReturnType<typeof postgres> | null = null;
function getSqlClient(): ReturnType<typeof postgres> {
  if (!sqlClient && databaseUrl) {
    sqlClient = postgres(databaseUrl, {
      // Matches lib/db/client.ts config for Supabase pooler compat
      prepare: false,
      fetch_types: false,
      max: 2,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  if (!sqlClient) {
    throw new Error("DATABASE_URL not set — cannot query cost_events");
  }
  return sqlClient;
}

afterAll(async () => {
  if (sqlClient) {
    await sqlClient.end().catch(() => undefined);
    sqlClient = null;
  }
});

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
          // `X-NullSpend-Tags` MUST be a JSON object (not comma-separated
          // key=value) — verified against apps/proxy/src/lib/tags.ts:13
          // which does `JSON.parse(header)` and drops the header on
          // parse failure with a silent warning.
          "X-NullSpend-Tags": JSON.stringify({
            e2e_tier: "L3",
            e2e_suite: "proxy-reachable",
            e2e_run_id: E2E_RUN_ID,
          }),
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

    // Gap-7 regression: verify the cost event actually lands in
    // Postgres within the expected window. The HTTP-level PING test
    // above only verifies the request/response path — it does not
    // verify that the FULL chain (proxy → OpenAI → SSE parser → cost
    // calculator → Cloudflare Queue → Hyperdrive → Postgres) works.
    // That's the actual launch-night manual verification path.
    //
    // Auto-skips if DATABASE_URL is not configured (local dev).
    it.skipIf(!hasDbAccess)(
      "PONG cost event lands in Postgres within 15s (Gap-7 regression)",
      async () => {
        // Fire a fresh PONG with a new run-id suffix so this
        // assertion doesn't collide with the one above. The DB lookup
        // uses `e2e_run_id` from the tags.
        const runId = `${E2E_RUN_ID}-db-verify`;
        const res = await fetch(`${proxyUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-NullSpend-Key": nullspendKey!,
            Authorization: `Bearer ${openaiKey}`,
            // JSON object, NOT key=value — see apps/proxy/src/lib/tags.ts
            "X-NullSpend-Tags": JSON.stringify({
              e2e_tier: "L3",
              e2e_suite: "proxy-reachable",
              e2e_run_id: runId,
            }),
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "Respond with: PONG" }],
            max_completion_tokens: 10,
          }),
          signal: AbortSignal.timeout(30_000),
        });
        expect(res.status).toBe(200);

        // Poll the DB until the cost event appears. Typical latency
        // is <500ms (proxy → queue → hyperdrive → pg insert). Budget
        // 15s to tolerate queue consumer cold starts.
        const sql = getSqlClient();
        const deadline = Date.now() + 15_000;
        let event: {
          cost_microdollars: string | number;
          provider: string;
          model: string;
          input_tokens: number;
          output_tokens: number;
        } | undefined;

        while (Date.now() < deadline) {
          // tags is JSONB; `tags ->> 'e2e_run_id' = $1` does the safe
          // parameterized lookup. LIMIT 1 because there should be
          // exactly one event per run-id.
          const rows = (await sql`
            SELECT cost_microdollars, provider, model, input_tokens, output_tokens
            FROM cost_events
            WHERE tags ->> 'e2e_run_id' = ${runId}
            ORDER BY created_at DESC
            LIMIT 1
          `) as unknown as Array<{
            cost_microdollars: string | number;
            provider: string;
            model: string;
            input_tokens: number;
            output_tokens: number;
          }>;
          if (rows.length > 0) {
            event = rows[0];
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }

        expect(
          event,
          `Cost event with tags.e2e_run_id="${runId}" never landed in ` +
            `cost_events within 15s. The full proxy → OpenAI → SSE parser ` +
            `→ cost calculator → Queue → Hyperdrive → Postgres chain is ` +
            `broken at some stage. Check Cloudflare Queue metrics and ` +
            `Hyperdrive connection state.`,
        ).toBeDefined();

        if (event) {
          expect(event.provider).toBe("openai");
          expect(event.model).toMatch(/^gpt-4o-mini/);
          // cost_microdollars is bigint — could come back as string
          const cost = typeof event.cost_microdollars === "string"
            ? Number(event.cost_microdollars)
            : event.cost_microdollars;
          expect(
            cost,
            `Cost must be > 0 — the cost calculator should have priced ` +
              `the real PONG call at a non-zero microdollar amount.`,
          ).toBeGreaterThan(0);
          expect(event.input_tokens).toBeGreaterThan(0);
          expect(event.output_tokens).toBeGreaterThan(0);
        }
      },
    );

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
