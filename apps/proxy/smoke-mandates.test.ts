/**
 * Live smoke tests for model/provider mandate enforcement and the policy endpoint.
 *
 * Strategy: Set restrictions once in beforeAll, wait for cache expiry (130s),
 * then run all enforcement tests against the stable restricted state.
 * This avoids flakiness from multi-isolate cache invalidation timing.
 *
 * Requires:
 *   - Live proxy at PROXY_URL
 *   - OPENAI_API_KEY, ANTHROPIC_API_KEY, NULLSPEND_API_KEY
 *   - NULLSPEND_SMOKE_KEY_ID (key UUID for updating restrictions)
 *   - DATABASE_URL for restriction setup
 *   - INTERNAL_SECRET for cache invalidation
 *
 * Run with: cd apps/proxy && npx vitest run smoke-mandates.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import {
  BASE,
  OPENAI_API_KEY,
  ANTHROPIC_API_KEY,
  NULLSPEND_API_KEY,
  NULLSPEND_SMOKE_KEY_ID,
  INTERNAL_SECRET,
  authHeaders,
  anthropicAuthHeaders,
  smallRequest,
  smallAnthropicRequest,
  isServerUp,
  syncBudget,
} from "./smoke-test-helpers.js";

describe("Mandate enforcement + policy endpoint (live)", () => {
  let sql: postgres.Sql;
  let orgId: string;

  beforeAll(async () => {
    const up = await isServerUp();
    if (!up) throw new Error("Proxy not reachable.");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required.");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY required.");
    if (!NULLSPEND_API_KEY) throw new Error("NULLSPEND_API_KEY required.");
    if (!NULLSPEND_SMOKE_KEY_ID) throw new Error("NULLSPEND_SMOKE_KEY_ID required.");
    if (!INTERNAL_SECRET) throw new Error("INTERNAL_SECRET required.");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required.");

    sql = postgres(process.env.DATABASE_URL!, { max: 3, idle_timeout: 10 });

    const [key] = await sql`SELECT org_id FROM api_keys WHERE id = ${NULLSPEND_SMOKE_KEY_ID!}`;
    if (!key?.org_id) throw new Error("Smoke test API key has no org_id");
    orgId = key.org_id;

    // Set restrictions: only gpt-4o-mini allowed, only openai provider allowed
    await sql`
      UPDATE api_keys
      SET allowed_models = ${["gpt-4o-mini"]}, allowed_providers = ${["openai"]}
      WHERE id = ${NULLSPEND_SMOKE_KEY_ID!}
    `;

    // Invalidate cache across isolates
    for (let i = 0; i < 5; i++) {
      await syncBudget(orgId, "api_key", NULLSPEND_SMOKE_KEY_ID!);
      await new Promise((r) => setTimeout(r, 500));
    }

    // Poll the policy endpoint until restrictions are visible (cache propagated)
    // This is more reliable than a fixed wait: it confirms the proxy sees the changes.
    console.log("[smoke-mandates] Restrictions set, polling policy endpoint for propagation...");
    const pollStart = Date.now();
    const maxWaitMs = 180_000; // 3 minutes max
    while (Date.now() - pollStart < maxWaitMs) {
      const res = await fetch(`${BASE}/v1/policy`, {
        method: "GET",
        headers: { "x-nullspend-key": NULLSPEND_API_KEY! },
      });
      if (res.ok) {
        const body = await res.json() as { allowed_models: string[] | null };
        if (body.allowed_models && body.allowed_models.length > 0) {
          console.log(`[smoke-mandates] Restrictions visible after ${Math.round((Date.now() - pollStart) / 1000)}s`);
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }

    // Final verification
    const verify = await fetch(`${BASE}/v1/policy`, {
      method: "GET",
      headers: { "x-nullspend-key": NULLSPEND_API_KEY! },
    });
    const verifyBody = await verify.json() as { allowed_models: string[] | null };
    if (!verifyBody.allowed_models) {
      throw new Error(
        `Restrictions not visible after ${Math.round(maxWaitMs / 1000)}s. ` +
        `Auth cache may not have propagated. Possible Hyperdrive query cache issue.`
      );
    }
    console.log("[smoke-mandates] Restrictions confirmed, running tests.");
  }, 180_000); // 3 minute timeout for beforeAll

  afterAll(async () => {
    // Clear restrictions
    await sql`
      UPDATE api_keys
      SET allowed_models = NULL, allowed_providers = NULL
      WHERE id = ${NULLSPEND_SMOKE_KEY_ID!}
    `;
    // Best-effort cache flush
    for (let i = 0; i < 3; i++) {
      await syncBudget(orgId, "api_key", NULLSPEND_SMOKE_KEY_ID!).catch(() => {});
    }
    await sql.end();
  });

  // ── Allowed requests pass ──

  it("allows OpenAI request with allowed model (gpt-4o-mini)", async () => {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest({ model: "gpt-4o-mini" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("choices");
  }, 30_000);

  // ── Model restriction blocks ──

  it("blocks OpenAI request with disallowed model (gpt-4o)", async () => {
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest({ model: "gpt-4o" }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("mandate_violation");
    expect(body.error.details.mandate).toBe("allowed_models");
    expect(body.error.details.requested).toBe("gpt-4o");
    expect(body.error.details.allowed).toEqual(["gpt-4o-mini"]);
    expect(res.headers.get("X-NullSpend-Trace-Id")).toBeTruthy();
  }, 30_000);

  // ── Provider restriction blocks ──

  it("blocks Anthropic request (only openai provider allowed)", async () => {
    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: smallAnthropicRequest(),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("mandate_violation");
    expect(body.error.details.mandate).toBe("allowed_providers");
    expect(body.error.details.requested).toBe("anthropic");
    expect(body.error.details.allowed).toEqual(["openai"]);
  }, 30_000);

  // ── No cost event for denied requests ──

  it("mandate denial does not create a cost event", async () => {
    const before = new Date();
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest({ model: "gpt-4o" }),
    });

    expect(res.status).toBe(403);

    // Wait for any async cost event writes
    await new Promise((r) => setTimeout(r, 5_000));

    const rows = await sql`
      SELECT COUNT(*)::int as count FROM cost_events
      WHERE api_key_id = ${NULLSPEND_SMOKE_KEY_ID!}
        AND created_at >= ${before.toISOString()}
        AND model = 'gpt-4o'
    `;
    expect(rows[0].count).toBe(0);
  }, 30_000);

  // ── Policy endpoint ──

  it("GET /v1/policy returns valid shape with restrictions", async () => {
    const res = await fetch(`${BASE}/v1/policy`, {
      method: "GET",
      headers: { "x-nullspend-key": NULLSPEND_API_KEY! },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-NullSpend-Trace-Id")).toBeTruthy();

    const body = await res.json();
    expect(body).toHaveProperty("budget");
    expect(body).toHaveProperty("allowed_models");
    expect(body).toHaveProperty("allowed_providers");
    expect(body).toHaveProperty("cheapest_per_provider");
    expect(body).toHaveProperty("cheapest_overall");
    expect(body).toHaveProperty("restrictions_active");

    // Verify restrictions from our setup
    expect(body.allowed_models).toEqual(["gpt-4o-mini"]);
    expect(body.allowed_providers).toEqual(["openai"]);
    expect(body.restrictions_active).toBe(true);

    // Cheapest should be gpt-4o-mini (only allowed model)
    expect(body.cheapest_overall).not.toBeNull();
    expect(body.cheapest_overall.model).toBe("gpt-4o-mini");
    expect(body.cheapest_overall.provider).toBe("openai");
  });

  it("GET /v1/policy returns 401 without API key", async () => {
    const res = await fetch(`${BASE}/v1/policy`, { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("GET /v1/policy responds within 500ms (warm path)", async () => {
    // Warm up
    await fetch(`${BASE}/v1/policy`, {
      method: "GET",
      headers: { "x-nullspend-key": NULLSPEND_API_KEY! },
    });

    const start = performance.now();
    const res = await fetch(`${BASE}/v1/policy`, {
      method: "GET",
      headers: { "x-nullspend-key": NULLSPEND_API_KEY! },
    });
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(500);
  });
});
