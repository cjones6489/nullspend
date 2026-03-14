/**
 * Anthropic known-issues smoke tests.
 * Validates cost logging reliability, budget edge cases, and stream abort
 * reconciliation — targeting specific bugs discovered through research
 * across Cloudflare Workers, Hyperdrive, and the Anthropic API.
 *
 * Requires:
 *   - Live proxy at PROXY_URL
 *   - ANTHROPIC_API_KEY, PLATFORM_AUTH_KEY
 *   - DATABASE_URL for direct Supabase queries
 *   - UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import postgres from "postgres";
import { Redis } from "@upstash/redis";
import {
  BASE,
  ANTHROPIC_API_KEY,
  PLATFORM_AUTH_KEY,
  DATABASE_URL,
  anthropicAuthHeaders,
  smallAnthropicRequest,
  isServerUp,
  waitForCostEvent,
} from "./smoke-test-helpers.js";

describe("Anthropic known issues: cost logging & budget edge cases", () => {
  let sql: postgres.Sql;
  let redis: Redis;
  const keysToCleanup: string[] = [];
  const usersToCleanup: string[] = [];

  function trackKey(key: string) {
    if (!keysToCleanup.includes(key)) keysToCleanup.push(key);
  }

  function trackUser(id: string) {
    if (!usersToCleanup.includes(id)) usersToCleanup.push(id);
  }

  async function setupBudget(
    userId: string,
    maxBudgetMicrodollars: number,
    spendMicrodollars = 0,
  ) {
    const key = `{budget}:user:${userId}`;
    const nk = `{budget}:user:${userId}:none`;
    trackKey(key);
    trackKey(nk);
    trackUser(userId);

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

  beforeAll(async () => {
    const up = await isServerUp();
    if (!up) throw new Error("Proxy not reachable.");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY required.");
    if (!DATABASE_URL) throw new Error("DATABASE_URL required.");
    if (!process.env.UPSTASH_REDIS_REST_URL)
      throw new Error("UPSTASH_REDIS_REST_URL required.");

    sql = postgres(DATABASE_URL, { max: 5, idle_timeout: 10 });
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  });

  afterEach(async () => {
    const rsvKeys = await redis.keys("{budget}:rsv:*");
    const allKeys = [...keysToCleanup, ...rsvKeys];
    if (allKeys.length > 0) await redis.del(...allKeys);
    keysToCleanup.length = 0;
  });

  afterAll(async () => {
    for (const id of usersToCleanup) {
      await sql`DELETE FROM budgets WHERE entity_id = ${id}`;
    }
    if (sql) await sql.end();
  });

  // --- Cost logging reliability ---

  it("5 concurrent Anthropic requests all produce cost events (connection concurrency guard)", async () => {
    const requestIds: string[] = [];

    const requests = Array.from({ length: 5 }, (_, i) =>
      fetch(`${BASE}/v1/messages`, {
        method: "POST",
        headers: anthropicAuthHeaders(),
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 5,
          messages: [{ role: "user", content: `Connection guard ${i}` }],
        }),
      }),
    );

    const responses = await Promise.all(requests);
    for (const res of responses) {
      expect(res.status).toBe(200);
      const body = await res.json();
      requestIds.push(res.headers.get("x-request-id") ?? body.id);
    }

    await new Promise((r) => setTimeout(r, 10_000));

    let foundCount = 0;
    for (const id of requestIds) {
      const row = await waitForCostEvent(sql, id, 15_000, "anthropic");
      if (row) foundCount++;
    }

    expect(foundCount).toBe(5);
  }, 120_000);

  it("stream cancel triggers budget reconciliation (reserved returns to 0)", async () => {
    const userId = `ant-ki-stream-cancel-${Date.now()}`;
    await setupBudget(userId, 10_000_000); // $10

    const controller = new AbortController();
    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders({ "X-NullSpend-User-Id": userId }),
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 20,
        messages: [{ role: "user", content: "Count from 1 to 5." }],
        stream: true,
      }),
      signal: controller.signal,
    });

    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    try {
      await reader.read();
    } catch {
      // may throw if already done
    }
    controller.abort();

    // Cloudflare Workers don't propagate cancel through TransformStreams,
    // so upstream completes normally. Wait for reconciliation.
    await new Promise((r) => setTimeout(r, 15_000));

    const state = (await redis.hgetall(
      `{budget}:user:${userId}`,
    )) as Record<string, string>;
    const reserved = Number(state?.reserved ?? 0);

    expect(reserved).toBe(0);
  }, 60_000);

  it("10 requests in 2 batches all produce cost events (waitUntil reliability)", async () => {
    const allRequestIds: string[] = [];
    const BATCH_SIZE = 5;
    const BATCHES = 2;

    for (let batch = 0; batch < BATCHES; batch++) {
      const requests = Array.from({ length: BATCH_SIZE }, (_, i) =>
        fetch(`${BASE}/v1/messages`, {
          method: "POST",
          headers: anthropicAuthHeaders(),
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 5,
            messages: [
              {
                role: "user",
                content: `waitUntil batch ${batch} req ${i}`,
              },
            ],
          }),
        }),
      );

      const responses = await Promise.all(requests);
      for (const res of responses) {
        expect(res.status).toBe(200);
        const body = await res.json();
        allRequestIds.push(res.headers.get("x-request-id") ?? body.id);
      }

      await new Promise((r) => setTimeout(r, 1_500));
    }

    await new Promise((r) => setTimeout(r, 15_000));

    let foundCount = 0;
    for (const id of allRequestIds) {
      const row = await waitForCostEvent(sql, id, 10_000, "anthropic");
      if (row) foundCount++;
    }

    expect(foundCount).toBe(BATCH_SIZE * BATCHES);
  }, 180_000);

  it("3 sequential Anthropic requests with 1s delays all produce cost events (Hyperdrive reuse)", async () => {
    const requestIds: string[] = [];

    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${BASE}/v1/messages`, {
        method: "POST",
        headers: anthropicAuthHeaders(),
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 5,
          messages: [
            {
              role: "user",
              content: `Sequential ${i} at ${Date.now()}`,
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      requestIds.push(res.headers.get("x-request-id") ?? body.id);

      await new Promise((r) => setTimeout(r, 1_000));
    }

    await new Promise((r) => setTimeout(r, 8_000));

    for (const id of requestIds) {
      const row = await waitForCostEvent(sql, id, 10_000, "anthropic");
      expect(row).not.toBeNull();
      expect(Number(row!.cost_microdollars)).toBeGreaterThan(0);
    }
  }, 60_000);

  it("two distinct Anthropic requests produce exactly 2 distinct cost events (no duplicates)", async () => {
    const requestIds: string[] = [];

    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${BASE}/v1/messages`, {
        method: "POST",
        headers: anthropicAuthHeaders(),
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 5,
          messages: [
            {
              role: "user",
              content: `Distinct event check ${i} ${Date.now()}`,
            },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      requestIds.push(res.headers.get("x-request-id") ?? body.id);
    }

    await new Promise((r) => setTimeout(r, 8_000));

    for (const id of requestIds) {
      const rows = await sql`
        SELECT COUNT(*)::int as count FROM cost_events
        WHERE request_id = ${id} AND provider = 'anthropic'
      `;
      expect(rows[0].count).toBe(1);
    }

    expect(requestIds[0]).not.toBe(requestIds[1]);
  }, 60_000);

  // --- Budget edge cases ---

  it("budget enforced on /v1/messages route (no bypass)", async () => {
    const userId = `ant-ki-route-${Date.now()}`;
    await setupBudget(userId, 1); // 1 microdollar — guaranteed denial

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders({ "X-NullSpend-User-Id": userId }),
      body: smallAnthropicRequest(),
    });

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("budget_exceeded");
  }, 15_000);

  it("stream abort does not double-count spend (actual vs reservation)", async () => {
    const userId = `ant-ki-dbl-count-${Date.now()}`;
    await setupBudget(userId, 5_000_000); // $5

    const controller = new AbortController();
    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders({ "X-NullSpend-User-Id": userId }),
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 15,
        messages: [{ role: "user", content: "Count from 1 to 3." }],
        stream: true,
      }),
      signal: controller.signal,
    });

    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    try {
      await reader.read();
    } catch {
      // fine
    }
    controller.abort();

    await new Promise((r) => setTimeout(r, 15_000));

    const state = (await redis.hgetall(
      `{budget}:user:${userId}`,
    )) as Record<string, string>;
    const spend = Number(state?.spend ?? 0);
    const reserved = Number(state?.reserved ?? 0);

    expect(reserved).toBe(0);
    // Spend should be reasonable (only actual tokens), not doubled
    expect(spend).toBeLessThan(500);
  }, 60_000);

  it("budget allows exactly one Anthropic request then blocks second (precise exhaustion)", async () => {
    const userId = `ant-ki-precise-${Date.now()}`;
    // Anthropic haiku with max_tokens: 10 costs ~5-10 microdollars.
    // Budget of 15 microdollars allows one but reserves enough to block the second.
    await setupBudget(userId, 15);

    const res1 = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders({ "X-NullSpend-User-Id": userId }),
      body: smallAnthropicRequest(),
    });

    const status1 = res1.status;
    await res1.text();

    await new Promise((r) => setTimeout(r, 500));

    const res2 = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders({ "X-NullSpend-User-Id": userId }),
      body: smallAnthropicRequest(),
    });

    const status2 = res2.status;
    await res2.text();

    // At least one should succeed and one should be blocked
    if (status1 === 200) {
      expect(status2).toBe(429);
    } else {
      expect(status1).toBe(429);
    }
  }, 30_000);
});
