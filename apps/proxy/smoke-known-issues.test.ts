/**
 * Known-issues smoke tests targeting specific bugs discovered through
 * research across Cloudflare Workers, Hyperdrive, node-postgres, and
 * the OpenAI API.
 *
 * Requires:
 *   - Live proxy at PROXY_URL
 *   - OPENAI_API_KEY, PLATFORM_AUTH_KEY
 *   - DATABASE_URL for direct Supabase queries
 *   - UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import postgres from "postgres";
import { Redis } from "@upstash/redis";
import { BASE, OPENAI_API_KEY, PLATFORM_AUTH_KEY, DATABASE_URL, authHeaders, smallRequest, isServerUp, waitForCostEvent } from "./smoke-test-helpers.js";

describe("Known issues: connection exhaustion & waitUntil reliability", () => {
  let sql: postgres.Sql;
  let redis: Redis;

  beforeAll(async () => {
    const up = await isServerUp();
    if (!up) throw new Error("Proxy not reachable.");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required.");
    if (!DATABASE_URL) throw new Error("DATABASE_URL required.");
    if (!process.env.UPSTASH_REDIS_REST_URL) throw new Error("UPSTASH_REDIS_REST_URL required.");

    sql = postgres(DATABASE_URL, { max: 5, idle_timeout: 10 });
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  });

  afterAll(async () => {
    if (sql) await sql.end();
  });

  it("10 concurrent requests all produce cost events (connection concurrency guard)", async () => {
    const requestIds: string[] = [];

    const requests = Array.from({ length: 10 }, (_, i) =>
      fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: smallRequest({ messages: [{ role: "user", content: `Connection guard ${i}` }] }),
      }),
    );

    const responses = await Promise.all(requests);
    for (const res of responses) {
      expect(res.status).toBe(200);
      const body = await res.json();
      const requestId = res.headers.get("x-request-id") ?? body.id;
      requestIds.push(requestId);
    }

    // Wait for all waitUntil tasks to complete
    await new Promise((r) => setTimeout(r, 10_000));

    let foundCount = 0;
    for (const id of requestIds) {
      const row = await waitForCostEvent(sql, id, 15_000);
      if (row) foundCount++;
    }

    // All 10 must have cost events — no deadlocks, no dropped writes
    expect(foundCount).toBe(10);
  }, 120_000);

  it("stream cancel triggers budget reconciliation (reserved returns to 0)", async () => {
    const userId = `ki-stream-cancel-${Date.now()}`;
    const budgetKey = `{budget}:user:${userId}`;
    const noneKey = `{budget}:user:${userId}:none`;

    // Set up a generous budget so the request is approved
    await redis.del(budgetKey, noneKey);
    await redis.hset(budgetKey, {
      maxBudget: "10000000",
      spend: "0",
      reserved: "0",
      policy: "strict_block",
    });
    await redis.expire(budgetKey, 300);
    await sql`
      INSERT INTO budgets (entity_type, entity_id, max_budget_microdollars, spend_microdollars, policy)
      VALUES ('user', ${userId}, 10000000, 0, 'strict_block')
      ON CONFLICT (entity_type, entity_id)
      DO UPDATE SET max_budget_microdollars = 10000000, spend_microdollars = 0, updated_at = NOW()
    `;

    // Start a streaming request and abort it mid-stream.
    // Use short max_tokens so upstream finishes quickly even though
    // Cloudflare Workers don't propagate client disconnect.
    const controller = new AbortController();
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(userId),
      body: smallRequest({
        stream: true,
        messages: [{ role: "user", content: "Count from 1 to 5." }],
        max_tokens: 20,
      }),
      signal: controller.signal,
    });

    expect(res.status).toBe(200);

    // Read one chunk then abort
    const reader = res.body!.getReader();
    try {
      await reader.read();
    } catch {
      // may throw if already done
    }
    controller.abort();

    // Cloudflare Workers don't propagate cancel through TransformStreams,
    // so the upstream stream completes normally. Wait for OpenAI to finish
    // and for the waitUntil reconciliation to run.
    await new Promise((r) => setTimeout(r, 15_000));

    const state = await redis.hgetall(budgetKey) as Record<string, string>;
    const reserved = Number(state?.reserved ?? 0);

    // After abort + reconciliation, reserved should be back to 0
    expect(reserved).toBe(0);

    // Cleanup
    await redis.del(budgetKey, noneKey);
    const rsvKeys = await redis.keys("{budget}:rsv:*");
    if (rsvKeys.length > 0) await redis.del(...rsvKeys);
    await sql`DELETE FROM budgets WHERE entity_id = ${userId}`;
  }, 60_000);

  it("20 requests in 4 batches all produce cost events (waitUntil reliability)", async () => {
    const allRequestIds: string[] = [];
    const BATCH_SIZE = 5;
    const BATCHES = 4;

    for (let batch = 0; batch < BATCHES; batch++) {
      const requests = Array.from({ length: BATCH_SIZE }, (_, i) =>
        fetch(`${BASE}/v1/chat/completions`, {
          method: "POST",
          headers: authHeaders(),
          body: smallRequest({
            messages: [{ role: "user", content: `waitUntil batch ${batch} req ${i}` }],
          }),
        }),
      );

      const responses = await Promise.all(requests);
      for (const res of responses) {
        expect(res.status).toBe(200);
        const body = await res.json();
        allRequestIds.push(res.headers.get("x-request-id") ?? body.id);
      }

      // Brief pause between batches
      await new Promise((r) => setTimeout(r, 1_500));
    }

    // Wait for all background tasks
    await new Promise((r) => setTimeout(r, 15_000));

    let foundCount = 0;
    for (const id of allRequestIds) {
      const row = await waitForCostEvent(sql, id, 10_000);
      if (row) foundCount++;
    }

    // Every single one must land — not 19/20 or 18/20
    expect(foundCount).toBe(BATCH_SIZE * BATCHES);
  }, 180_000);

  it("5 sequential requests with 1s delays all produce cost events (Hyperdrive reuse)", async () => {
    const requestIds: string[] = [];

    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: smallRequest({
          messages: [{ role: "user", content: `Sequential ${i} at ${Date.now()}` }],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      requestIds.push(res.headers.get("x-request-id") ?? body.id);

      await new Promise((r) => setTimeout(r, 1_000));
    }

    await new Promise((r) => setTimeout(r, 8_000));

    for (const id of requestIds) {
      const row = await waitForCostEvent(sql, id, 10_000);
      expect(row).not.toBeNull();
      expect(Number(row!.cost_microdollars)).toBeGreaterThan(0);
    }
  }, 60_000);

  it("two distinct requests produce exactly 2 distinct cost events", async () => {
    const before = new Date();
    const requestIds: string[] = [];

    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: smallRequest({
          messages: [{ role: "user", content: `Distinct event check ${i} ${Date.now()}` }],
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      requestIds.push(res.headers.get("x-request-id") ?? body.id);
    }

    await new Promise((r) => setTimeout(r, 8_000));

    // Verify each has exactly one cost event
    for (const id of requestIds) {
      const rows = await sql`
        SELECT COUNT(*)::int as count FROM cost_events
        WHERE request_id = ${id} AND provider = 'openai'
      `;
      expect(rows[0].count).toBe(1);
    }

    // Verify they are distinct rows
    expect(requestIds[0]).not.toBe(requestIds[1]);
  }, 60_000);
});
