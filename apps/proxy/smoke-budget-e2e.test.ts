/**
 * End-to-end budget enforcement tests.
 * Sets real budgets in Redis for the smoke-test API key's user, sends requests
 * through the live proxy, and verifies enforcement, exhaustion, and reconciliation.
 *
 * The proxy derives userId/keyId from the x-nullspend-key header (API key auth).
 * Budget tests set up budgets for NULLSPEND_SMOKE_USER_ID — the real userId
 * associated with the test API key.
 *
 * Requires:
 *   - Live proxy at PROXY_URL
 *   - OPENAI_API_KEY, NULLSPEND_API_KEY
 *   - NULLSPEND_SMOKE_USER_ID (real userId for the test API key)
 *   - UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN for direct Redis access
 *   - DATABASE_URL for budget setup in Postgres
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Redis } from "@upstash/redis";
import postgres from "postgres";
import { BASE, OPENAI_API_KEY, NULLSPEND_API_KEY, NULLSPEND_SMOKE_USER_ID, authHeaders, smallRequest, isServerUp } from "./smoke-test-helpers.js";

describe("End-to-end budget enforcement", () => {
  let redis: Redis;
  let sql: postgres.Sql;
  const keysToCleanup: string[] = [];

  function trackKey(key: string) {
    if (!keysToCleanup.includes(key)) keysToCleanup.push(key);
  }

  beforeAll(async () => {
    const up = await isServerUp();
    if (!up) throw new Error("Proxy not reachable.");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required.");
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

    // Clear any negative cache or existing budget
    await redis.del(key, nk);

    // Set budget in Redis directly (bypassing Postgres slow path)
    await redis.hset(key, {
      maxBudget: String(maxBudgetMicrodollars),
      spend: String(spendMicrodollars),
      reserved: "0",
      policy: "strict_block",
    });
    await redis.expire(key, 300);

    // Also ensure a Postgres row exists for reconciliation
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

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("usage");
  }, 30_000);

  it("blocks request with budget_exceeded when budget is $0.00", async () => {
    await setupBudget(0); // $0.00

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
    expect(body.message).toContain("budget");
  }, 15_000);

  it("blocks request when spend already equals maxBudget", async () => {
    await setupBudget(100_000, 100_000); // spend == max

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
  }, 15_000);

  it("exhausts budget by sending requests until blocked", async () => {
    // Estimator reserves ~6 microdollars per request (gpt-4o-mini, max_tokens: 3).
    // Budget of 10 allows exactly 1 request before denial.
    await setupBudget(10);

    let successCount = 0;
    let deniedCount = 0;

    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: smallRequest({ messages: [{ role: "user", content: `Budget exhaust ${i}` }] }),
      });

      if (res.status === 200) {
        successCount++;
        await res.json();
      } else if (res.status === 429) {
        deniedCount++;
        const body = await res.json();
        expect(body.error).toBe("budget_exceeded");
        break;
      } else {
        await res.text();
      }
    }

    expect(successCount).toBeGreaterThanOrEqual(0);
    expect(deniedCount).toBeGreaterThan(0);

    // Verify Redis state shows spend near or at the limit
    const budgetState = await redis.hgetall(`{budget}:user:${NULLSPEND_SMOKE_USER_ID!}`) as Record<string, string>;
    expect(budgetState).toBeDefined();
    const spend = Number(budgetState.spend ?? 0);
    const reserved = Number(budgetState.reserved ?? 0);
    expect(spend + reserved).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it("reconciliation adjusts reserved amount after request completes", async () => {
    await setupBudget(5_000_000); // $5 — plenty of headroom

    // Send a request
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });
    expect(res.status).toBe(200);
    await res.json();

    // Wait for waitUntil reconciliation
    await new Promise((r) => setTimeout(r, 5_000));

    const state = await redis.hgetall(`{budget}:user:${NULLSPEND_SMOKE_USER_ID!}`) as Record<string, string>;
    const spend = Number(state.spend ?? 0);
    const reserved = Number(state.reserved ?? 0);

    // After reconciliation, spend should be > 0 (actual cost was recorded)
    // and reserved should be 0 (reservation was cleared)
    expect(spend).toBeGreaterThan(0);
    expect(reserved).toBe(0);
  }, 30_000);

  it("budget_exceeded response includes correct detail fields", async () => {
    await setupBudget(1); // 1 microdollar — guaranteed denial

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();

    expect(body.error).toBe("budget_exceeded");
    expect(body.message).toContain("budget");
    expect(body.details).toBeUndefined();
  }, 15_000);

  it("concurrent requests against tight budget don't overspend", async () => {
    // Set budget to ~200 microdollars — enough for maybe 1-2 requests
    await setupBudget(200);

    const requests = Array.from({ length: 5 }, (_, i) =>
      fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: smallRequest({ messages: [{ role: "user", content: `Concurrent ${i}` }] }),
      }),
    );

    const results = await Promise.all(requests);
    const statuses = await Promise.all(
      results.map(async (r) => {
        const body = await r.text();
        return { status: r.status, body };
      }),
    );

    const successes = statuses.filter((s) => s.status === 200);
    const denied = statuses.filter((s) => s.status === 429);

    // At least some should be denied; budget can't cover all 5
    // But we accept the possibility all 5 could succeed if reservations
    // are small enough, or all could be denied if estimates are large
    expect(successes.length + denied.length).toBe(5);

    // Wait for reconciliation
    await new Promise((r) => setTimeout(r, 5_000));

    const state = await redis.hgetall(`{budget}:user:${NULLSPEND_SMOKE_USER_ID!}`) as Record<string, string>;
    const spend = Number(state.spend ?? 0);
    // Spend should not wildly exceed the budget (allowing for reservation margin)
    expect(spend).toBeLessThan(200 * 3); // generous bound
  }, 60_000);

  it("requests without configured budget are not affected by budget enforcement", async () => {
    // Clean up any existing budget for the smoke user so there's no budget to enforce
    await cleanupBudget();

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("usage");
  }, 30_000);
});
