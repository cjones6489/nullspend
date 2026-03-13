/**
 * End-to-end budget enforcement tests for Anthropic.
 * Sets real budgets in Redis, sends requests through the live proxy
 * to /v1/messages, and verifies enforcement, exhaustion, and reconciliation.
 *
 * Requires:
 *   - Live proxy at PROXY_URL
 *   - ANTHROPIC_API_KEY, PLATFORM_AUTH_KEY
 *   - UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN for direct Redis access
 *   - DATABASE_URL for budget setup in Postgres
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Redis } from "@upstash/redis";
import postgres from "postgres";
import {
  BASE,
  ANTHROPIC_API_KEY,
  PLATFORM_AUTH_KEY,
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
    if (!process.env.UPSTASH_REDIS_REST_URL) throw new Error("UPSTASH_REDIS_REST_URL required.");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required.");

    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });

    sql = postgres(process.env.DATABASE_URL!, { max: 3, idle_timeout: 10 });
  });

  afterEach(async () => {
    const rsvKeys = await redis.keys("{budget}:rsv:*");
    const allKeys = [...keysToCleanup, ...rsvKeys];
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
    }
    keysToCleanup.length = 0;
  });

  afterAll(async () => {
    await sql`DELETE FROM budgets WHERE entity_id LIKE 'ant-budget-e2e-%'`;
    await sql.end();
  });

  async function setupBudget(userId: string, maxBudgetMicrodollars: number, spendMicrodollars = 0) {
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

  it("allows request when budget has sufficient funds", async () => {
    const userId = `ant-budget-e2e-allow-${Date.now()}`;
    await setupBudget(userId, 10_000_000); // $10

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders({ "X-AgentSeam-User-Id": userId }),
      body: smallAnthropicRequest(),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("usage");
  }, 30_000);

  it("blocks request with budget_exceeded when budget is $0", async () => {
    const userId = `ant-budget-e2e-zero-${Date.now()}`;
    await setupBudget(userId, 0);

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders({ "X-AgentSeam-User-Id": userId }),
      body: smallAnthropicRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
    expect(body.details).toBeDefined();
    expect(body.details.remaining_microdollars).toBeLessThanOrEqual(0);
  }, 15_000);

  it("blocks when spend already equals maxBudget", async () => {
    const userId = `ant-budget-e2e-full-${Date.now()}`;
    await setupBudget(userId, 100_000, 100_000);

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders({ "X-AgentSeam-User-Id": userId }),
      body: smallAnthropicRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
  }, 15_000);

  it("reconciliation adjusts reserved amount after request completes", async () => {
    const userId = `ant-budget-e2e-reconcile-${Date.now()}`;
    await setupBudget(userId, 5_000_000); // $5

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders({ "X-AgentSeam-User-Id": userId }),
      body: smallAnthropicRequest(),
    });
    expect(res.status).toBe(200);
    await res.json();

    // Wait for waitUntil reconciliation (Anthropic round-trips can be slower)
    await new Promise((r) => setTimeout(r, 10_000));

    const state = await redis.hgetall(`{budget}:user:${userId}`) as Record<string, string>;
    const spend = Number(state.spend ?? 0);
    const reserved = Number(state.reserved ?? 0);

    expect(spend).toBeGreaterThan(0);
    expect(reserved).toBe(0);
  }, 30_000);

  it("budget_exceeded response includes correct detail fields", async () => {
    const userId = `ant-budget-e2e-details-${Date.now()}`;
    await setupBudget(userId, 1); // 1 microdollar

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders({ "X-AgentSeam-User-Id": userId }),
      body: smallAnthropicRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();

    expect(body.error).toBe("budget_exceeded");
    expect(body.message).toContain("budget");
    expect(body.details).toHaveProperty("entity_key");
    expect(body.details).toHaveProperty("remaining_microdollars");
    expect(body.details).toHaveProperty("estimated_microdollars");
    expect(body.details).toHaveProperty("budget_limit_microdollars");
    expect(body.details).toHaveProperty("spent_microdollars");
    expect(body.details.budget_limit_microdollars).toBe(1);
  }, 15_000);

  it("requests without budget headers are not affected by enforcement", async () => {
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
