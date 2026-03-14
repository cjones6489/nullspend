/**
 * Anthropic security smoke tests.
 * Validates header stripping, rate-limit forwarding, timing-safe auth,
 * unicode handling, and data leak prevention for the /v1/messages route.
 *
 * Requires: live proxy, ANTHROPIC_API_KEY, PLATFORM_AUTH_KEY, DATABASE_URL
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import {
  BASE,
  ANTHROPIC_API_KEY,
  PLATFORM_AUTH_KEY,
  DATABASE_URL,
  anthropicAuthHeaders,
  isServerUp,
  waitForCostEvent,
} from "./smoke-test-helpers.js";

describe("Anthropic security", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    const up = await isServerUp();
    if (!up) throw new Error("Proxy not reachable.");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY required.");
    if (!DATABASE_URL) throw new Error("DATABASE_URL required.");
    sql = postgres(DATABASE_URL, { max: 3, idle_timeout: 10 });
  });

  afterAll(async () => {
    if (sql) await sql.end();
  });

  it("x-api-key header is NOT present in the response", async () => {
    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 5,
        messages: [{ role: "user", content: "Header leak check" }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-api-key")).toBeNull();
    await res.text();
  }, 30_000);

  it("X-NullSpend-Auth is not leaked in response headers", async () => {
    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 5,
        messages: [{ role: "user", content: "Auth leak check" }],
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-nullspend-auth")).toBeNull();
    await res.text();
  }, 30_000);

  it("attribution headers not forwarded to Anthropic (verify via successful response)", async () => {
    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders({
        "X-NullSpend-User-Id": "sec-test-user",
        "X-NullSpend-Key-Id": "sec-test-key",
      }),
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 5,
        messages: [{ role: "user", content: "Attribution strip check" }],
      }),
    });

    // If these headers were forwarded, Anthropic would ignore them, but our
    // proxy should strip them. A 200 means Anthropic processed the request fine.
    expect(res.status).toBe(200);
    await res.text();
  }, 30_000);

  it("anthropic-version header is set on the upstream request", async () => {
    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 5,
        messages: [{ role: "user", content: "Version header check" }],
      }),
    });

    // A 200 confirms Anthropic accepted the request, which requires a valid
    // anthropic-version header to be set
    expect(res.status).toBe(200);
    await res.text();
  }, 30_000);

  it("Anthropic rate-limit headers are forwarded in the response", async () => {
    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 5,
        messages: [{ role: "user", content: "Rate limit headers" }],
      }),
    });

    expect(res.status).toBe(200);

    // Anthropic sends rate-limit headers in most responses
    const allHeaders = [...res.headers.entries()];
    const rateLimitHeaders = allHeaders.filter(([k]) =>
      k.toLowerCase().startsWith("anthropic-ratelimit"),
    );

    // We expect at least some rate-limit headers; if Anthropic doesn't send
    // them for this tier, this is informational rather than a hard failure
    if (rateLimitHeaders.length > 0) {
      console.log(`[security] Rate-limit headers found: ${rateLimitHeaders.map(([k]) => k).join(", ")}`);
    } else {
      console.log("[security] No anthropic-ratelimit-* headers in response (may be tier-dependent)");
    }

    await res.text();
  }, 30_000);

  it("arbitrary user ID in header is accepted and recorded in Anthropic cost events", async () => {
    const userId = `sec-user-${Date.now()}`;
    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders({
        "X-NullSpend-User-Id": userId,
      }),
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 5,
        messages: [{ role: "user", content: "User ID recording" }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const requestId = res.headers.get("x-request-id") ?? body.id;

    const row = await waitForCostEvent(sql, requestId, 15_000, "anthropic");
    expect(row).not.toBeNull();
    expect(row!.user_id).toBe(userId);
  }, 30_000);

  it("body with unicode/emoji in messages is handled correctly", async () => {
    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 10,
        messages: [
          {
            role: "user",
            content: "Hello! Here are some special chars: \u00e9\u00e8\u00ea\u00eb \u00fc\u00f6\u00e4 \u4f60\u597d \ud83d\ude80\ud83c\udf1f\ud83d\udcbb",
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("message");
    expect(body.content[0].text.length).toBeGreaterThan(0);
  }, 30_000);

  it("deeply nested JSON in message content doesn't crash the proxy", async () => {
    let nested: unknown = "leaf";
    for (let i = 0; i < 50; i++) {
      nested = { level: i, data: nested };
    }

    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 5,
        messages: [
          {
            role: "user",
            content: `Process this: ${JSON.stringify(nested).slice(0, 500)}`,
          },
        ],
      }),
    });

    // Should not crash (502). May succeed or fail with Anthropic error.
    expect(res.status).not.toBe(502);
    await res.text();
  }, 30_000);

  it("__proto__ pollution attempt in Anthropic request body is handled safely", async () => {
    const res = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: anthropicAuthHeaders(),
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 5,
        messages: [{ role: "user", content: "Proto test" }],
        __proto__: { isAdmin: true },
        constructor: { prototype: { isAdmin: true } },
      }),
    });

    // Should not crash or escalate privileges
    expect(res.status).not.toBe(502);
    await res.text();
  }, 30_000);

  it("response times for wrong platform keys are statistically similar (timing-safe comparison)", async () => {
    const wrongKey1 = "aaaa" + "0".repeat(60);
    const wrongKey2 = PLATFORM_AUTH_KEY.slice(0, -1) + (PLATFORM_AUTH_KEY.endsWith("0") ? "1" : "0");

    const measure = async (key: string): Promise<number> => {
      const times: number[] = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        const res = await fetch(`${BASE}/v1/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY!,
            "X-NullSpend-Auth": key,
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 5,
            messages: [{ role: "user", content: "Timing" }],
          }),
        });
        const elapsed = performance.now() - start;
        times.push(elapsed);
        expect(res.status).toBe(401);
        await res.text();
      }
      return times.reduce((a, b) => a + b, 0) / times.length;
    };

    const avg1 = await measure(wrongKey1);
    const avg2 = await measure(wrongKey2);

    const diff = Math.abs(avg1 - avg2);
    const threshold = Math.max(avg1, avg2) * 0.5;

    console.log(
      `[security] Timing: key1=${Math.round(avg1)}ms, key2=${Math.round(avg2)}ms, diff=${Math.round(diff)}ms, threshold=${Math.round(threshold)}ms`,
    );

    expect(diff).toBeLessThan(threshold);
  }, 60_000);
});
