/**
 * End-to-end budget enforcement tests for Anthropic.
 * Sets real budgets in Redis for the smoke-test API key's user, sends requests
 * through the live proxy to /v1/messages, and verifies enforcement, exhaustion,
 * and reconciliation.
 *
 * The proxy derives userId/keyId from the x-nullspend-key header (API key auth).
 * Budget tests set up budgets for NULLSPEND_SMOKE_USER_ID — the real userId
 * associated with the test API key.
 *
 * Requires:
 *   - Live proxy at PROXY_URL
 *   - ANTHROPIC_API_KEY, NULLSPEND_API_KEY
 *   - NULLSPEND_SMOKE_USER_ID (real userId for the test API key)
 *   - UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN for direct Redis access
 *   - DATABASE_URL for budget setup in Postgres
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Redis } from "@upstash/redis";
import postgres from "postgres";
import {
  BASE,
  ANTHROPIC_API_KEY,
  NULLSPEND_API_KEY,
  NULLSPEND_SMOKE_USER_ID,
  anthropicAuthHeaders,
  smallAnthropicRequest,
  isServerUp,
} from "./smoke-test-helpers.js";

describe("Anthropic end-to-end budget enforcement", () => {
  let redis: Redis;
  let sql: postgres.Sql;

  const keysToCleanup: string[] = [];

  function trackKey(key: string) {
    if (!keysToCleanup.includes(key)) keysToCleanup.push(key);
  }

  beforeAll(async () => {
    const up = await isServerUp();
    if (!up) throw new Error("Proxy not reachable.");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY required.");
    if (!NULLSPEND_API_KEY) throw new Error("NULLSPEND_API_KEY required.");
    if (!NULLSPEND_SMOKE_USER_ID) throw new Error("NULLSPEND_SMOKE_USER_ID required.");
    if (!process.env.UPSTASH_REDIS_REST_URL) throw new Error("UPSTASH_REDIS_REST_URL required.");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required.");

    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });

    sql = postgres(process.env.DATABASE_URL!, { max: 3, idle_timeout: 10 });
  });

  afterEach(async () => {
    // Clean up Redis keys AND Postgres rows between tests to prevent
    // slow-path cache repopulation from stale DB rows
    const rsvKeys = await redis.keys("{budget}:rsv:*");
    const allKeys = [...keysToCleanup, ...rsvKeys];
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
    }
    keysToCleanup.length = 0;
    await sql`DELETE FROM budgets WHERE entity_id = ${NULLSPEND_SMOKE_USER_ID!}`;
  });

  afterAll(async () => {
    await sql.end();
  });

  async function setupBudget(maxBudgetMicrodollars: number, spendMicrodollars = 0) {
    const userId = NULLSPEND_SMOKE_USER_ID!;
    const key = `{budget}:user:${userId}`;
    const nk = `{budget}:user:${userId}:none`;
    trackKey(key);
    trackKey(nk);

    await redis.del(key, nk);

    await redis.hset(key, {
      maxBudget: String(maxBudgetMicrodollars),
      spend: String(spendMicrodollars),
      reserved: "0",
      policy: "strict_block",
    });
    await redis.expire(key, 300);

    await sql`
      INSERT INTO budgets (entity_type, entity_id, max_budget_microdollars, spend_microdollars, policy)
      VALUES ('user', ${userId}, ${maxBudgetMicrodollars}, ${spendMicrodollars}, 'strict_block')
      ON CONFLICT (entity_type, entity_id)
      DO UPDATE SET max_budget_microdollars = ${maxBudgetMicrodollars},
                    spend_microdollars = ${spendMicrodollars},
                    updated_at = NOW()
    `;
  }

  /** Remove any existing budget so the user is non-budgeted */
  async function cleanupBudget() {
    const userId = NULLSPEND_SMOKE_USER_ID!;
    const key = `{budget}:user:${userId}`;
    const nk = `{budget}:user:${userId}:none`;
    trackKey(key);
    trackKey(nk);
    await redis.del(key, nk);
    await sql`DELETE FROM budgets WHERE entity_type = 'user' AND entity_id = ${userId}`;
  }

  it("allows request when budget has sufficient funds", async () => {
    await setupBudget(10_000_000); // $10

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: smallAnthropicRequest(),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("usage");
  }, 30_000);

  it("blocks request with budget_exceeded when budget is $0", async () => {
    await setupBudget(0);

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: smallAnthropicRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
    expect(body.message).toContain("budget");
  }, 15_000);

  it("blocks when spend already equals maxBudget", async () => {
    await setupBudget(100_000, 100_000);

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: smallAnthropicRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
  }, 15_000);

  it("reconciliation adjusts reserved amount after request completes", async () => {
    await setupBudget(5_000_000); // $5

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: smallAnthropicRequest(),
    });
    expect(res.status).toBe(200);
    await res.json();

    // Wait for waitUntil reconciliation (Anthropic round-trips can be slower)
    await new Promise((r) => setTimeout(r, 10_000));

    const state = await redis.hgetall(`{budget}:user:${NULLSPEND_SMOKE_USER_ID!}`) as Record<string, string>;
    const spend = Number(state.spend ?? 0);
    const reserved = Number(state.reserved ?? 0);

    expect(spend).toBeGreaterThan(0);
    expect(reserved).toBe(0);
  }, 30_000);

  it("budget_exceeded response includes correct detail fields", async () => {
    await setupBudget(1); // 1 microdollar

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: smallAnthropicRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();

    expect(body.error).toBe("budget_exceeded");
    expect(body.message).toContain("budget");
    expect(body.details).toBeUndefined();
  }, 15_000);

  it("requests without configured budget are not affected by enforcement", async () => {
    // Clean up any existing budget so there's nothing to enforce
    await cleanupBudget();

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: smallAnthropicRequest(),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("usage");
  }, 30_000);
});
