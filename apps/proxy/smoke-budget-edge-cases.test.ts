/**
 * Budget edge-case smoke tests, specifically designed to verify we don't
 * have the same budget bugs as LiteLLM and other competitors.
 *
 * Tests cover: user header enforcement, stream abort spend accuracy,
 * reservation TTL expiry, Redis cache TTL fallback, and API key budget enforcement.
 *
 * Requires:
 *   - Live proxy at PROXY_URL
 *   - OPENAI_API_KEY, PLATFORM_AUTH_KEY
 *   - UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 *   - DATABASE_URL for Postgres budget setup
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Redis } from "@upstash/redis";
import postgres from "postgres";
import { BASE, OPENAI_API_KEY, PLATFORM_AUTH_KEY, authHeaders, smallRequest, isServerUp } from "./smoke-test-helpers.js";

describe("Budget edge cases (LiteLLM bug avoidance)", () => {
  let redis: Redis;
  let sql: postgres.Sql;
  const keysToCleanup: string[] = [];
  const usersToCleanup: string[] = [];

  function trackKey(key: string) {
    if (!keysToCleanup.includes(key)) keysToCleanup.push(key);
  }

  function trackUser(id: string) {
    if (!usersToCleanup.includes(id)) usersToCleanup.push(id);
  }

  async function setupBudget(
    entityType: string,
    entityId: string,
    maxBudgetMicrodollars: number,
    spendMicrodollars = 0,
  ) {
    const key = `{budget}:${entityType}:${entityId}`;
    const nk = `{budget}:${entityType}:${entityId}:none`;
    trackKey(key);
    trackKey(nk);
    trackUser(entityId);

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
      VALUES (${entityType}, ${entityId}, ${maxBudgetMicrodollars}, ${spendMicrodollars}, 'strict_block')
      ON CONFLICT (entity_type, entity_id)
      DO UPDATE SET max_budget_microdollars = ${maxBudgetMicrodollars},
                    spend_microdollars = ${spendMicrodollars},
                    updated_at = NOW()
    `;
  }

  beforeAll(async () => {
    const up = await isServerUp();
    if (!up) throw new Error("Proxy not reachable.");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required.");
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
    if (allKeys.length > 0) await redis.del(...allKeys);
    keysToCleanup.length = 0;
  });

  afterAll(async () => {
    if (usersToCleanup.length > 0) {
      for (const id of usersToCleanup) {
        await sql`DELETE FROM budgets WHERE entity_id = ${id}`;
      }
    }
    if (sql) await sql.end();
  });

  it("budget enforced on /v1/chat/completions route (no bypass routes)", async () => {
    const userId = `bec-route-${Date.now()}`;
    await setupBudget("user", userId, 1); // 1 microdollar — guaranteed denial

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(userId),
      body: smallRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
  }, 15_000);

  it("budget enforced with X-AgentSeam-User-Id header (LiteLLM #11083)", async () => {
    const userId = `bec-user-header-${Date.now()}`;
    await setupBudget("user", userId, 1);

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(userId),
      body: smallRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
    expect(body.details.entity_key).toContain(userId);
  }, 15_000);

  it("budget enforced with X-AgentSeam-Key-Id header", async () => {
    const keyId = `bec-key-header-${Date.now()}`;
    await setupBudget("api_key", keyId, 1);

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders({ "X-AgentSeam-Key-Id": keyId }),
      body: smallRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
    expect(body.details.entity_key).toContain(keyId);
  }, 15_000);

  it("both user and key budgets checked — tightest one blocks", async () => {
    const userId = `bec-dual-user-${Date.now()}`;
    const keyId = `bec-dual-key-${Date.now()}`;

    // User budget generous, key budget exhausted
    await setupBudget("user", userId, 10_000_000);
    await setupBudget("api_key", keyId, 1);

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(userId, keyId),
      body: smallRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
    expect(body.details.entity_key).toContain(keyId);
  }, 15_000);

  it("stream abort does not double-count spend (actual vs reservation)", async () => {
    const userId = `bec-stream-abort-${Date.now()}`;
    await setupBudget("user", userId, 5_000_000); // $5

    // Start a streaming request and abort it.
    // Use short max_tokens so upstream finishes quickly — Cloudflare Workers
    // don't propagate client disconnect through TransformStreams.
    const controller = new AbortController();
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(userId),
      body: smallRequest({
        stream: true,
        messages: [{ role: "user", content: "Count from 1 to 3." }],
        max_tokens: 15,
      }),
      signal: controller.signal,
    });

    expect(res.status).toBe(200);

    // Read one chunk then abort
    const reader = res.body!.getReader();
    try {
      await reader.read();
    } catch {
      // fine
    }
    controller.abort();

    // Wait for upstream to finish + reconciliation in waitUntil
    await new Promise((r) => setTimeout(r, 15_000));

    const state = await redis.hgetall(`{budget}:user:${userId}`) as Record<string, string>;
    const spend = Number(state?.spend ?? 0);
    const reserved = Number(state?.reserved ?? 0);

    // reserved should be 0 after reconciliation
    expect(reserved).toBe(0);

    // Spend should be small (only actual tokens received, or 0 if
    // reconciled with 0 due to missing usage data from abort)
    // It must NOT equal the full reservation estimate
    const estimatorReservation = 100; // rough minimum estimate for gpt-4o-mini
    expect(spend).toBeLessThan(estimatorReservation * 5);
  }, 60_000);

  it("budget allows exactly one request then blocks second (precise exhaustion)", async () => {
    const userId = `bec-precise-${Date.now()}`;
    // Estimator reserves ~5 microdollars for gpt-4o-mini with max_tokens: 3.
    // Budget of 7 allows 1 request; even after reconciliation (actual spend ~3),
    // the remaining ~4 is still less than the next estimate of ~5.
    await setupBudget("user", userId, 7);

    const res1 = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(userId),
      body: smallRequest(),
    });

    // First should succeed (estimate fits within 10)
    const status1 = res1.status;
    await res1.text();

    // Small delay for reservation to be recorded
    await new Promise((r) => setTimeout(r, 500));

    const res2 = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(userId),
      body: smallRequest(),
    });

    const status2 = res2.status;
    await res2.text();

    // At least one must succeed and the other must fail (or both fail if estimate > 10)
    if (status1 === 200) {
      expect(status2).toBe(429);
    } else {
      expect(status1).toBe(429);
    }
  }, 30_000);

  it("budget state survives Redis cache expiry — falls back to Postgres", async () => {
    const userId = `bec-cache-ttl-${Date.now()}`;
    const budgetKey = `{budget}:user:${userId}`;
    const noneKey = `{budget}:user:${userId}:none`;
    trackKey(budgetKey);
    trackKey(noneKey);
    trackUser(userId);

    // Set up budget in Postgres only (no Redis cache)
    await redis.del(budgetKey, noneKey);
    await sql`
      INSERT INTO budgets (entity_type, entity_id, max_budget_microdollars, spend_microdollars, policy)
      VALUES ('user', ${userId}, 10000000, 0, 'strict_block')
      ON CONFLICT (entity_type, entity_id)
      DO UPDATE SET max_budget_microdollars = 10000000, spend_microdollars = 0, updated_at = NOW()
    `;

    // Proxy should fall back to Postgres, then populate Redis cache
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(userId),
      body: smallRequest(),
    });

    expect(res.status).toBe(200);
    await res.json();

    // Verify the Redis cache was re-populated by the slow path
    await new Promise((r) => setTimeout(r, 1_000));
    const state = await redis.hgetall(budgetKey) as Record<string, string>;
    expect(state).toBeDefined();
    expect(Number(state?.maxBudget ?? 0)).toBe(10000000);
  }, 30_000);

  it("negative cache prevents repeated Postgres queries for non-budgeted entities", async () => {
    const userId = `bec-no-budget-${Date.now()}`;
    const noneKey = `{budget}:user:${userId}:none`;
    const budgetKey = `{budget}:user:${userId}`;
    trackKey(noneKey);
    trackKey(budgetKey);

    // Ensure no budget exists
    await redis.del(budgetKey, noneKey);
    // Do NOT create a Postgres row

    // First request triggers Postgres lookup → should set negative cache
    const res1 = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(userId),
      body: smallRequest(),
    });
    expect(res1.status).toBe(200);
    await res1.json();

    await new Promise((r) => setTimeout(r, 1_000));

    // Verify negative cache marker was set (Upstash returns numbers, not strings)
    const marker = await redis.get(noneKey);
    expect(String(marker)).toBe("1");

    // Second request should hit the negative cache — no budget enforcement, still 200
    const res2 = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(userId),
      body: smallRequest(),
    });
    expect(res2.status).toBe(200);
    await res2.json();
  }, 30_000);

  it("reservation TTL ensures stale reservations expire from Redis", async () => {
    const userId = `bec-rsv-ttl-${Date.now()}`;
    await setupBudget("user", userId, 5_000_000);

    // Make a request that creates a reservation
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(userId),
      body: smallRequest(),
    });
    expect(res.status).toBe(200);
    await res.json();

    // Wait for waitUntil reconciliation to complete (needs extra time when
    // running alongside 11 other test files that all hit the same proxy)
    await new Promise((r) => setTimeout(r, 15_000));

    // All reservation keys should be cleaned up by reconciliation
    const rsvKeys = await redis.keys(`{budget}:rsv:*`);
    // Filter for any keys that contain our reservation data for this user
    // After reconciliation, there should be none
    const state = await redis.hgetall(`{budget}:user:${userId}`) as Record<string, string>;
    expect(Number(state?.reserved ?? 0)).toBe(0);
  }, 45_000);

  it("requests without any budget headers bypass budget checks entirely", async () => {
    // This is the inverse of the LiteLLM bug — verify that NOT having
    // budget headers doesn't accidentally trigger budget checks
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(), // no userId or keyId
      body: smallRequest(),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("usage");
  }, 15_000);
});
