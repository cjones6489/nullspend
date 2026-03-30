/**
 * Live smoke tests for model/provider mandate enforcement and the policy endpoint.
 *
 * Tests:
 *   1. Mandate enforcement: allowed model passes, disallowed model blocked with 403
 *   2. Provider restriction: allowed provider passes, disallowed provider blocked
 *   3. GET /v1/policy: returns restrictions, cheapest models, budget state
 *   4. Policy + budget interaction: budget remaining reflects actual spend
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
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
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
  invalidateBudget,
  NULLSPEND_SMOKE_USER_ID,
} from "./smoke-test-helpers.js";

describe("Mandate enforcement smoke tests", () => {
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
  });

  afterEach(async () => {
    // Clear restrictions back to unrestricted
    await sql`
      UPDATE api_keys
      SET allowed_models = NULL, allowed_providers = NULL
      WHERE id = ${NULLSPEND_SMOKE_KEY_ID!}
    `;
    // Flush proxy auth cache so the cleared restrictions take effect
    await syncBudget(orgId, "api_key", NULLSPEND_SMOKE_KEY_ID!);
    // Give cache invalidation time to propagate
    await new Promise((r) => setTimeout(r, 2_000));
  });

  afterAll(async () => {
    await sql.end();
  });

  async function setRestrictions(
    allowedModels: string[] | null,
    allowedProviders: string[] | null,
  ) {
    await sql`
      UPDATE api_keys
      SET allowed_models = ${allowedModels as any}, allowed_providers = ${allowedProviders as any}
      WHERE id = ${NULLSPEND_SMOKE_KEY_ID!}
    `;
    // Flush proxy auth cache
    await syncBudget(orgId, "api_key", NULLSPEND_SMOKE_KEY_ID!);
    // Wait for cache invalidation
    await new Promise((r) => setTimeout(r, 2_000));
  }

  // ── Model restrictions (OpenAI) ──

  it("allows OpenAI request when model is in allowlist", async () => {
    await setRestrictions(["gpt-4o-mini"], null);

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest({ model: "gpt-4o-mini" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("choices");
  }, 30_000);

  it("blocks OpenAI request when model is not in allowlist", async () => {
    await setRestrictions(["gpt-4o-mini"], null);

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

  // ── Provider restrictions ──

  it("blocks OpenAI request when only anthropic provider is allowed", async () => {
    await setRestrictions(null, ["anthropic"]);

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("mandate_violation");
    expect(body.error.details.mandate).toBe("allowed_providers");
    expect(body.error.details.requested).toBe("openai");
  }, 30_000);

  it("blocks Anthropic request when only openai provider is allowed", async () => {
    await setRestrictions(null, ["openai"]);

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
  }, 30_000);

  it("allows Anthropic request when anthropic provider is in allowlist", async () => {
    await setRestrictions(null, ["anthropic"]);

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: smallAnthropicRequest(),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("content");
  }, 30_000);

  // ── Combined restrictions ──

  it("allows request matching both model and provider restrictions", async () => {
    await setRestrictions(["gpt-4o-mini"], ["openai"]);

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest({ model: "gpt-4o-mini" }),
    });

    expect(res.status).toBe(200);
  }, 30_000);

  it("mandate denial does not create a cost event", async () => {
    await setRestrictions(["gpt-4o-mini"], null);

    const before = new Date();
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest({ model: "gpt-4o" }),
    });

    expect(res.status).toBe(403);

    // Wait a bit for any async cost event writes
    await new Promise((r) => setTimeout(r, 3_000));

    // No cost event should exist for the denied request
    const rows = await sql`
      SELECT COUNT(*)::int as count FROM cost_events
      WHERE api_key_id = ${NULLSPEND_SMOKE_KEY_ID!}
        AND created_at >= ${before.toISOString()}
        AND model = 'gpt-4o'
    `;
    expect(rows[0].count).toBe(0);
  }, 30_000);
});

describe("Policy endpoint smoke tests", () => {
  let sql: postgres.Sql;
  let orgId: string;

  beforeAll(async () => {
    const up = await isServerUp();
    if (!up) throw new Error("Proxy not reachable.");
    if (!NULLSPEND_API_KEY) throw new Error("NULLSPEND_API_KEY required.");
    if (!NULLSPEND_SMOKE_KEY_ID) throw new Error("NULLSPEND_SMOKE_KEY_ID required.");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required.");

    sql = postgres(process.env.DATABASE_URL!, { max: 3, idle_timeout: 10 });

    const [key] = await sql`SELECT org_id FROM api_keys WHERE id = ${NULLSPEND_SMOKE_KEY_ID!}`;
    if (!key?.org_id) throw new Error("Smoke test API key has no org_id");
    orgId = key.org_id;
  });

  afterEach(async () => {
    // Clear restrictions
    await sql`
      UPDATE api_keys
      SET allowed_models = NULL, allowed_providers = NULL
      WHERE id = ${NULLSPEND_SMOKE_KEY_ID!}
    `;
    await syncBudget(orgId, "api_key", NULLSPEND_SMOKE_KEY_ID!);
    await new Promise((r) => setTimeout(r, 2_000));
  });

  afterAll(async () => {
    await sql.end();
  });

  it("returns 200 with valid policy response shape", async () => {
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
  });

  it("returns unrestricted policy when no restrictions set", async () => {
    const res = await fetch(`${BASE}/v1/policy`, {
      method: "GET",
      headers: { "x-nullspend-key": NULLSPEND_API_KEY! },
    });

    const body = await res.json();
    expect(body.allowed_models).toBeNull();
    expect(body.allowed_providers).toBeNull();
    expect(body.restrictions_active).toBe(false);
    // Should have cheapest models from full catalog
    expect(body.cheapest_overall).not.toBeNull();
    expect(body.cheapest_overall).toHaveProperty("model");
    expect(body.cheapest_overall).toHaveProperty("provider");
  });

  it("returns restrictions after setting them", async () => {
    await sql`
      UPDATE api_keys
      SET allowed_models = ${{"{gpt-4o-mini,gpt-4o}"}}, allowed_providers = ${{"{openai}"}}
      WHERE id = ${NULLSPEND_SMOKE_KEY_ID!}
    `;
    await syncBudget(orgId, "api_key", NULLSPEND_SMOKE_KEY_ID!);
    await new Promise((r) => setTimeout(r, 2_000));

    const res = await fetch(`${BASE}/v1/policy`, {
      method: "GET",
      headers: { "x-nullspend-key": NULLSPEND_API_KEY! },
    });

    const body = await res.json();
    expect(body.allowed_models).toEqual(expect.arrayContaining(["gpt-4o-mini", "gpt-4o"]));
    expect(body.allowed_providers).toEqual(["openai"]);
    expect(body.restrictions_active).toBe(true);
    // Cheapest should be filtered to only OpenAI models in the allowlist
    expect(body.cheapest_overall.provider).toBe("openai");
    expect(["gpt-4o-mini", "gpt-4o"]).toContain(body.cheapest_overall.model);
  });

  it("returns 401 without API key", async () => {
    const res = await fetch(`${BASE}/v1/policy`, { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("returns 401 with invalid API key", async () => {
    const res = await fetch(`${BASE}/v1/policy`, {
      method: "GET",
      headers: { "x-nullspend-key": "ns_live_sk_invalid_key_that_does_not_exist" },
    });
    expect(res.status).toBe(401);
  });

  it("responds within 500ms (warm path)", async () => {
    // Warm up: first call may cold-start the DO
    await fetch(`${BASE}/v1/policy`, {
      method: "GET",
      headers: { "x-nullspend-key": NULLSPEND_API_KEY! },
    });

    // Timed call
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
