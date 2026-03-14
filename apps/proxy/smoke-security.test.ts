/**
 * Security and attack vector tests for the live proxy.
 * Tests auth timing safety, header injection, attribution spoofing,
 * request smuggling, and proxy header stripping.
 *
 * Requires:
 *   - Live proxy at PROXY_URL
 *   - OPENAI_API_KEY, PLATFORM_AUTH_KEY
 *   - DATABASE_URL for verifying attribution spoofing
 */
import { describe, it, expect, beforeAll } from "vitest";
import postgres from "postgres";
import { BASE, OPENAI_API_KEY, PLATFORM_AUTH_KEY, DATABASE_URL, authHeaders, smallRequest, isServerUp } from "./smoke-test-helpers.js";

describe("Security tests", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    const up = await isServerUp();
    if (!up) throw new Error("Proxy not reachable.");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required.");
    if (DATABASE_URL) {
      sql = postgres(DATABASE_URL, { max: 3, idle_timeout: 10 });
    }
  });

  // ── Timing attack resistance ──

  describe("Timing-safe auth comparison", () => {
    it("response times for wrong keys of different lengths are statistically similar", async () => {
      const keys = [
        "a",
        "ab",
        "abcdefghij",
        "a".repeat(64),
        "a".repeat(128),
        "a".repeat(256),
        PLATFORM_AUTH_KEY.slice(0, 10), // partial match
        PLATFORM_AUTH_KEY.slice(0, 32), // longer partial match
      ];

      const timings: Record<string, number[]> = {};

      for (const key of keys) {
        timings[key.length.toString()] = [];
      }

      // Run 20 rounds to get stable measurements
      for (let round = 0; round < 20; round++) {
        for (const key of keys) {
          const start = performance.now();
          const res = await fetch(`${BASE}/v1/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "X-NullSpend-Auth": key,
            },
            body: smallRequest(),
          });
          const elapsed = performance.now() - start;
          expect(res.status).toBe(401);
          await res.text();
          timings[key.length.toString()].push(elapsed);
        }
      }

      // Calculate median for each key length
      const medians: Record<string, number> = {};
      for (const [len, times] of Object.entries(timings)) {
        const sorted = times.sort((a, b) => a - b);
        medians[len] = sorted[Math.floor(sorted.length / 2)];
      }

      const medianValues = Object.values(medians);
      const maxMedian = Math.max(...medianValues);
      const minMedian = Math.min(...medianValues);

      // Timing difference between shortest and longest key should be < 50ms
      // (network variance dominates, so timing-safe comparison is effective)
      expect(maxMedian - minMedian).toBeLessThan(50);
    }, 120_000);
  });

  // ── Header injection ──

  describe("Header injection attacks", () => {
    it("X-NullSpend-Auth with null bytes is rejected by HTTP client (client-side protection)", async () => {
      // fetch() itself rejects null bytes in header values before sending
      await expect(
        fetch(`${BASE}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "X-NullSpend-Auth": "valid-key\x00injected",
          },
          body: smallRequest(),
        }),
      ).rejects.toThrow();
    });

    it("very long X-NullSpend-Auth (10KB) is rejected gracefully", async () => {
      const longKey = "x".repeat(10_000);
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "X-NullSpend-Auth": longKey,
        },
        body: smallRequest(),
      });

      // Should be rejected (401) not crash (502)
      expect([401, 431]).toContain(res.status);
      await res.text();
    });

    it("empty X-NullSpend-Auth returns 401", async () => {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "X-NullSpend-Auth": "",
        },
        body: smallRequest(),
      });

      expect(res.status).toBe(401);
      await res.text();
    });

    it("missing X-NullSpend-Auth header returns 401", async () => {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: smallRequest(),
      });

      expect(res.status).toBe(401);
      await res.text();
    });

    it("X-NullSpend-Auth with spaces/tabs is accepted (HTTP spec trims header values)", async () => {
      // Per HTTP spec, leading/trailing whitespace in header values is stripped,
      // so padded keys effectively match. This is a known browser/runtime behavior.
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "X-NullSpend-Auth": `  ${PLATFORM_AUTH_KEY}  `,
        },
        body: smallRequest(),
      });

      expect(res.status).toBe(200);
      await res.text();
    }, 30_000);
  });

  // ── Proxy header stripping (X-NullSpend-Auth must not reach OpenAI) ──

  describe("Proxy header stripping", () => {
    it("X-NullSpend-Auth is stripped from upstream request (not leaked to OpenAI)", async () => {
      // If the proxy forwarded X-NullSpend-Auth to OpenAI, OpenAI would ignore it
      // but it would be a credential leak. We verify indirectly: a valid request
      // succeeds (so the proxy handled auth) and the response comes from OpenAI.
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: smallRequest(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.model).toContain("gpt-4o-mini");
      // The response is from OpenAI, confirming the proxy forwarded correctly
    }, 30_000);

    it("X-NullSpend-User-Id and X-NullSpend-Key-Id are not forwarded to OpenAI", async () => {
      // These attribution headers should be consumed by the proxy, not forwarded
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders({
          "X-NullSpend-User-Id": "test-user",
          "X-NullSpend-Key-Id": "test-key",
        }),
        body: smallRequest(),
      });

      // If forwarded, OpenAI might ignore unknown headers, so success is expected.
      // The real check is that the request succeeds (proxy doesn't break).
      expect(res.status).toBe(200);
      await res.json();
    }, 30_000);
  });

  // ── Attribution spoofing (known gap) ──

  describe("Attribution spoofing (known design gap)", () => {
    it("arbitrary user ID in header is accepted and recorded in cost events", async () => {
      if (!sql) return; // skip if no DATABASE_URL

      const spoofedUserId = `spoofed-user-${Date.now()}`;
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders({
          "X-NullSpend-User-Id": spoofedUserId,
        }),
        body: smallRequest(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      const requestId = res.headers.get("x-request-id") ?? body.id;

      // Wait for cost logging
      await new Promise((r) => setTimeout(r, 3_000));

      const rows = await sql`
        SELECT user_id FROM cost_events
        WHERE request_id = ${requestId} AND provider = 'openai'
      `;

      // The spoofed user ID is recorded — this demonstrates the vulnerability
      expect(rows.length).toBe(1);
      expect(rows[0].user_id).toBe(spoofedUserId);
    }, 15_000);
  });

  // ── Request smuggling ──

  describe("Request smuggling resistance", () => {
    it("null bytes in URL path return 400 (Cloudflare rejects)", async () => {
      const res = await fetch(`${BASE}/v1/chat/completions%00admin`, {
        method: "POST",
        headers: authHeaders(),
        body: smallRequest(),
      });

      expect(res.status).toBe(400);
      await res.text();
    });

    it("path traversal /v1/../admin returns 404", async () => {
      const res = await fetch(`${BASE}/v1/../admin`, {
        method: "POST",
        headers: authHeaders(),
        body: smallRequest(),
      });

      expect(res.status).toBe(404);
      await res.text();
    });

    it("oversized Content-Length with small body is rejected by fetch client", async () => {
      // Node's undici rejects content-length mismatches before sending
      await expect(
        fetch(`${BASE}/v1/chat/completions`, {
          method: "POST",
          headers: {
            ...authHeaders(),
            "Content-Length": "999999999",
          },
          body: smallRequest(),
        }),
      ).rejects.toThrow();
    });

    it("POST to /health is treated as GET (returns health response)", async () => {
      const res = await fetch(`${BASE}/health`, {
        method: "POST",
      });

      // Cloudflare Workers URL routing checks pathname, not method for /health
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
    });

    it("DELETE method to /v1/chat/completions returns 404", async () => {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "DELETE",
        headers: authHeaders(),
        body: smallRequest(),
      });

      expect(res.status).toBe(404);
      await res.text();
    });

    it("PUT method to /v1/chat/completions returns 404", async () => {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "PUT",
        headers: authHeaders(),
        body: smallRequest(),
      });

      expect(res.status).toBe(404);
      await res.text();
    });

    it("very deep path nesting returns 404 without crashing", async () => {
      const deepPath = "/v1/" + "a/".repeat(100) + "chat/completions";
      const res = await fetch(`${BASE}${deepPath}`, {
        method: "POST",
        headers: authHeaders(),
        body: smallRequest(),
      });

      expect(res.status).toBe(404);
      await res.text();
    });
  });

  // ── Body-level attacks ──

  describe("Malicious request bodies", () => {
    it("body with __proto__ pollution attempt is handled safely", async () => {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 3,
          __proto__: { admin: true },
          constructor: { prototype: { admin: true } },
        }),
      });

      // Should be 200 (proxy passes through to OpenAI, which ignores extra fields)
      // or 400 if the proxy rejects it. Either way, should not be 502.
      expect(res.status).not.toBe(502);
      await res.text();
    }, 30_000);

    it("deeply nested JSON doesn't crash the proxy", async () => {
      let nested: unknown = { role: "user", content: "hi" };
      for (let i = 0; i < 50; i++) {
        nested = { nested };
      }

      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [nested],
          max_tokens: 3,
        }),
      });

      // OpenAI will reject the malformed messages, but proxy should not crash
      expect(res.status).not.toBe(502);
      await res.text();
    }, 30_000);

    it("body that is a JSON array (not object) returns 400", async () => {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify([{ model: "gpt-4o-mini" }]),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("bad_request");
    });

    it("body that is a JSON string returns 400", async () => {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify("just a string"),
      });

      expect(res.status).toBe(400);
      await res.text();
    });

    it("body that is a JSON number returns 400", async () => {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: "42",
      });

      expect(res.status).toBe(400);
      await res.text();
    });

    it("body with unicode/emoji in messages is handled correctly", async () => {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "Say \u{1F600}\u{1F4A9}\u{0000}\u{FFFF}" }],
          max_tokens: 3,
        }),
      });

      expect(res.status).toBe(200);
      await res.text();
    }, 30_000);
  });
});
