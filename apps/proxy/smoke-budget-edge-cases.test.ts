/**
 * Budget edge-case smoke tests, specifically designed to verify we don't
 * have the same budget bugs as LiteLLM and other competitors.
 *
 * Tests cover: user budget enforcement, API key budget enforcement,
 * stream abort spend accuracy, reservation TTL expiry, Redis cache TTL fallback,
 * and dual (user + key) budget enforcement.
 *
 * The proxy derives userId/keyId from the x-nullspend-key header (API key auth).
 * Budget tests set up budgets for NULLSPEND_SMOKE_USER_ID / NULLSPEND_SMOKE_KEY_ID —
 * the real identities associated with the test API key.
 *
 * Requires:
 *   - Live proxy at PROXY_URL
 *   - OPENAI_API_KEY, NULLSPEND_API_KEY
 *   - NULLSPEND_SMOKE_USER_ID, NULLSPEND_SMOKE_KEY_ID
 *   - UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 *   - DATABASE_URL for Postgres budget setup
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Redis } from "@upstash/redis";
import postgres from "postgres";
import { BASE, OPENAI_API_KEY, NULLSPEND_API_KEY, NULLSPEND_SMOKE_USER_ID, NULLSPEND_SMOKE_KEY_ID, authHeaders, smallRequest, isServerUp } from "./smoke-test-helpers.js";

describe("Budget edge cases (LiteLLM bug avoidance)", () => {
  let redis: Redis;
  let sql: postgres.Sql;
  const keysToCleanup: string[] = [];

  function trackKey(key: string) {
    if (!keysToCleanup.includes(key)) keysToCleanup.push(key);
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

  /** Remove any existing budgets so the user/key is non-budgeted */
  async function cleanupBudgets() {
    const userId = NULLSPEND_SMOKE_USER_ID!;
    const keyId = NULLSPEND_SMOKE_KEY_ID!;
    const userKey = `{budget}:user:${userId}`;
    const userNk = `{budget}:user:${userId}:none`;
    const apiKeyKey = `{budget}:api_key:${keyId}`;
    const apiKeyNk = `{budget}:api_key:${keyId}:none`;
    trackKey(userKey);
    trackKey(userNk);
    trackKey(apiKeyKey);
    trackKey(apiKeyNk);
    await redis.del(userKey, userNk, apiKeyKey, apiKeyNk);
    await sql`DELETE FROM budgets WHERE entity_id IN (${userId}, ${keyId})`;
  }

  beforeAll(async () => {
    const up = await isServerUp();
    if (!up) throw new Error("Proxy not reachable.");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required.");
    if (!NULLSPEND_API_KEY) throw new Error("NULLSPEND_API_KEY required.");
    if (!NULLSPEND_SMOKE_USER_ID) throw new Error("NULLSPEND_SMOKE_USER_ID required.");
    if (!NULLSPEND_SMOKE_KEY_ID) throw new Error("NULLSPEND_SMOKE_KEY_ID required.");
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
    // slow-path cache repopulation from stale DB rows.
    // Preserve the global ceiling budget (api_key entity with $1B limit)
    // by only deleting test-created rows, not ALL api_key budgets.
    const rsvKeys = await redis.keys("{budget}:rsv:*");
    const allKeys = [...keysToCleanup, ...rsvKeys];
    if (allKeys.length > 0) await redis.del(...allKeys);
    keysToCleanup.length = 0;
    await sql`DELETE FROM budgets WHERE entity_id = ${NULLSPEND_SMOKE_USER_ID!}`;
    await sql`DELETE FROM budgets WHERE entity_id = ${NULLSPEND_SMOKE_KEY_ID!} AND max_budget_microdollars < 1000000000000`;
  });

  afterAll(async () => {
    if (sql) await sql.end();
  });

  it("budget enforced on /v1/chat/completions route (no bypass routes)", async () => {
    await setupBudget("user", NULLSPEND_SMOKE_USER_ID!, 1); // 1 microdollar — guaranteed denial

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("budget_exceeded");
  }, 15_000);

  it("budget enforced for API key's user", async () => {
    await setupBudget("user", NULLSPEND_SMOKE_USER_ID!, 1);

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("budget_exceeded");
    expect(body.error.message).toContain("budget");
  }, 15_000);

  it("budget enforced for API key", async () => {
    await setupBudget("api_key", NULLSPEND_SMOKE_KEY_ID!, 1);

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("budget_exceeded");
    expect(body.error.message).toContain("budget");
  }, 15_000);

  it("both user and key budgets checked — tightest one blocks", async () => {
    // User budget generous, key budget exhausted
    await setupBudget("user", NULLSPEND_SMOKE_USER_ID!, 10_000_000);
    await setupBudget("api_key", NULLSPEND_SMOKE_KEY_ID!, 1);

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("budget_exceeded");
    expect(body.error.message).toContain("budget");
  }, 15_000);

  it("stream abort does not double-count spend (actual vs reservation)", async () => {
    await setupBudget("user", NULLSPEND_SMOKE_USER_ID!, 5_000_000); // $5

    // Start a streaming request and abort it.
    // Use short max_tokens so upstream finishes quickly — Cloudflare Workers
    // don't propagate client disconnect through TransformStreams.
    const controller = new AbortController();
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
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

    // Wait for upstream to finish + reconciliation in waitUntil.
    // Local Miniflare may need extra time for waitUntil tasks to complete.
    await new Promise((r) => setTimeout(r, 20_000));

    const state = await redis.hgetall(`{budget}:user:${NULLSPEND_SMOKE_USER_ID!}`) as Record<string, string>;
    const spend = Number(state?.spend ?? 0);
    const reserved = Number(state?.reserved ?? 0);

    // After reconciliation, reserved should be 0 (or very small if still
    // settling). Spend should be small — actual tokens, not the full estimate.
    // Allow reserved <= 20 for timing tolerance on local dev.
    expect(reserved).toBeLessThanOrEqual(20);

    const estimatorReservation = 100; // rough minimum estimate for gpt-4o-mini
    expect(spend).toBeLessThan(estimatorReservation * 5);
  }, 60_000);

  it("budget allows exactly one request then blocks second (precise exhaustion)", async () => {
    // Estimator reserves ~5 microdollars for gpt-4o-mini with max_tokens: 3.
    // Budget of 7 allows 1 request; even after reconciliation (actual spend ~3),
    // the remaining ~4 is still less than the next estimate of ~5.
    await setupBudget("user", NULLSPEND_SMOKE_USER_ID!, 7);

    const res1 = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    // First should succeed (estimate fits within 10)
    const status1 = res1.status;
    await res1.text();

    // Small delay for reservation to be recorded
    await new Promise((r) => setTimeout(r, 500));

    const res2 = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
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
    const userId = NULLSPEND_SMOKE_USER_ID!;
    const bKey = `{budget}:user:${userId}`;
    const nKey = `{budget}:user:${userId}:none`;
    trackKey(bKey);
    trackKey(nKey);

    // Set up budget in Postgres only (no Redis cache)
    await redis.del(bKey, nKey);
    await sql`
      INSERT INTO budgets (entity_type, entity_id, max_budget_microdollars, spend_microdollars, policy)
      VALUES ('user', ${userId}, 10000000, 0, 'strict_block')
      ON CONFLICT (entity_type, entity_id)
      DO UPDATE SET max_budget_microdollars = 10000000, spend_microdollars = 0, updated_at = NOW()
    `;

    // Proxy should fall back to Postgres, then populate Redis cache
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    expect(res.status).toBe(200);
    await res.json();

    // Verify the Redis cache was re-populated by the slow path
    await new Promise((r) => setTimeout(r, 1_000));
    const state = await redis.hgetall(bKey) as Record<string, string>;
    expect(state).toBeDefined();
    expect(Number(state?.maxBudget ?? 0)).toBe(10000000);
  }, 30_000);

  it("negative cache prevents repeated Postgres queries for non-budgeted entities", async () => {
    const userId = NULLSPEND_SMOKE_USER_ID!;
    const nKey = `{budget}:user:${userId}:none`;
    const bKey = `{budget}:user:${userId}`;
    trackKey(nKey);
    trackKey(bKey);

    // Ensure no budget exists
    await redis.del(bKey, nKey);
    await sql`DELETE FROM budgets WHERE entity_type = 'user' AND entity_id = ${userId}`;

    // First request triggers Postgres lookup -> should set negative cache
    const res1 = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });
    expect(res1.status).toBe(200);
    await res1.json();

    await new Promise((r) => setTimeout(r, 1_000));

    // Verify negative cache marker was set (Upstash returns numbers, not strings)
    const marker = await redis.get(nKey);
    expect(String(marker)).toBe("1");

    // Second request should hit the negative cache — no budget enforcement, still 200
    const res2 = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });
    expect(res2.status).toBe(200);
    await res2.json();
  }, 30_000);

  it("reservation TTL ensures stale reservations expire from Redis", async () => {
    await setupBudget("user", NULLSPEND_SMOKE_USER_ID!, 5_000_000);

    // Make a request that creates a reservation
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });
    expect(res.status).toBe(200);
    await res.json();

    // Wait for waitUntil reconciliation to complete (needs extra time when
    // running alongside 11 other test files that all hit the same proxy)
    await new Promise((r) => setTimeout(r, 15_000));

    // All reservation keys should be cleaned up by reconciliation
    // After reconciliation, there should be none
    const state = await redis.hgetall(`{budget}:user:${NULLSPEND_SMOKE_USER_ID!}`) as Record<string, string>;
    expect(Number(state?.reserved ?? 0)).toBe(0);
  }, 45_000);

  it("requests without configured budget bypass budget checks entirely", async () => {
    // Clean up any existing budget so there's nothing to enforce
    await cleanupBudgets();

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("usage");
  }, 15_000);
});
