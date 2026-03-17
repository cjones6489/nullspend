/**
 * End-to-end observability smoke test for the NullSpend dashboard.
 *
 * Verifies that observability infrastructure works against the LIVE stack —
 * not mocks. This exists because the original stress test (2026-03-16) found
 * that unit tests passed while the live system had real failures.
 *
 * Requires:
 *   - Dev server running at http://127.0.0.1:3000 (or NULLSPEND_BASE_URL)
 *   - NULLSPEND_API_KEY in .env.local
 *
 * Run: pnpm e2e:observability
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch {
    return;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

const BASE_URL = process.env.NULLSPEND_BASE_URL ?? "http://127.0.0.1:3000";
const API_KEY = process.env.NULLSPEND_API_KEY;

if (!API_KEY) {
  console.error("NULLSPEND_API_KEY is not set.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

async function runTest(name: string, fn: () => Promise<void>) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: message });
    console.log("FAIL");
    console.log(`    ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Test 1 — x-request-id present on normal API response (200)
// ---------------------------------------------------------------------------

async function testRequestIdOnSuccess() {
  // Health endpoint may return 503 if DB is degraded — that's fine,
  // we're testing that x-request-id is present regardless of status.
  const res = await fetch(`${BASE_URL}/api/health`, {
    headers: { "x-nullspend-key": API_KEY! },
  });
  assert(
    res.status === 200 || res.status === 503,
    `expected 200 or 503, got ${res.status}`,
  );

  const requestId = res.headers.get("x-request-id");
  assert(requestId !== null, "x-request-id header should be present on response");
  assert(
    UUID_RE.test(requestId!),
    `x-request-id should be UUID format, got: ${requestId}`,
  );
}

// ---------------------------------------------------------------------------
// Test 2 — x-request-id is unique per request
// ---------------------------------------------------------------------------

async function testRequestIdUnique() {
  const res1 = await fetch(`${BASE_URL}/api/health`);
  const res2 = await fetch(`${BASE_URL}/api/health`);

  const id1 = res1.headers.get("x-request-id");
  const id2 = res2.headers.get("x-request-id");

  assert(id1 !== null, "first request should have x-request-id");
  assert(id2 !== null, "second request should have x-request-id");
  assert(id1 !== id2, `request IDs should be unique: ${id1} vs ${id2}`);
}

// ---------------------------------------------------------------------------
// Test 3 — x-request-id passthrough when client provides it
// ---------------------------------------------------------------------------

async function testRequestIdPassthrough() {
  const clientId = "e2e-test-client-id-12345678";
  const res = await fetch(`${BASE_URL}/api/health`, {
    headers: { "x-request-id": clientId },
  });

  const returnedId = res.headers.get("x-request-id");
  assertEqual(
    returnedId,
    clientId,
    "server should echo back client-provided x-request-id",
  );
}

// ---------------------------------------------------------------------------
// Test 4 — x-request-id present on error responses (400)
// ---------------------------------------------------------------------------

async function testRequestIdOnClientError() {
  // POST to an API route with invalid JSON to trigger a 400
  const res = await fetch(`${BASE_URL}/api/actions`, {
    method: "POST",
    headers: {
      "x-nullspend-key": API_KEY!,
      "content-type": "application/json",
    },
    body: "not-valid-json",
  });

  assertEqual(res.status, 400, "should get 400 for invalid JSON");
  const requestId = res.headers.get("x-request-id");
  assert(
    requestId !== null,
    "x-request-id header should be present on 400 error responses",
  );
}

// ---------------------------------------------------------------------------
// Test 5 — x-request-id present on auth error (401)
// ---------------------------------------------------------------------------

async function testRequestIdOnAuthError() {
  const res = await fetch(`${BASE_URL}/api/actions`, {
    method: "POST",
    headers: {
      "x-nullspend-key": "ask_bogus_key_that_does_not_exist",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      agentId: "test",
      actionType: "file_write",
      payload: {},
    }),
  });

  assert(
    res.status === 401 || res.status === 403,
    `expected 401 or 403, got ${res.status}`,
  );
  const requestId = res.headers.get("x-request-id");
  assert(
    requestId !== null,
    "x-request-id header should be present on auth error responses",
  );
}

// ---------------------------------------------------------------------------
// Test 6 — Health endpoint returns redis component (verbose mode)
// ---------------------------------------------------------------------------

async function testHealthRedisComponent() {
  const res = await fetch(`${BASE_URL}/api/health?verbose=1`);
  assert(res.ok || res.status === 503, `unexpected status: ${res.status}`);

  const body = await res.json();
  assert(
    body.components !== undefined,
    "verbose health should return components object",
  );
  assert(
    body.components.redis !== undefined,
    "health components should include redis",
  );
  assert(
    body.components.redis.status === "ok" ||
      body.components.redis.status === "error",
    `redis status should be ok or error, got: ${body.components.redis.status}`,
  );
}

// ---------------------------------------------------------------------------
// Test 7 — Health endpoint basic check
// ---------------------------------------------------------------------------

async function testHealthBasic() {
  const res = await fetch(`${BASE_URL}/api/health`);
  const body = await res.json();

  assert(
    body.status === "ok" || body.status === "degraded",
    `health status should be ok or degraded, got: ${body.status}`,
  );

  // Non-verbose should NOT include component details
  assertEqual(
    body.components,
    undefined,
    "non-verbose health should not include components",
  );
}

// ---------------------------------------------------------------------------
// Test 8 — Health endpoint database + schema components
// ---------------------------------------------------------------------------

async function testHealthDatabaseComponents() {
  const res = await fetch(`${BASE_URL}/api/health?verbose=1`);
  const body = await res.json();

  assert(
    body.components.database !== undefined,
    "health should include database component",
  );
  assert(
    body.components.database.status === "ok" ||
      body.components.database.status === "error",
    `database status should be ok or error, got: ${body.components.database.status}`,
  );

  // Schema component is only present when database is reachable
  if (body.components.database.status === "ok") {
    assert(
      body.components.schema !== undefined,
      "health should include schema component when DB is reachable",
    );
    assertEqual(
      body.components.schema.status,
      "ok",
      "schema should be ok against live stack (migrations applied)",
    );
  }
}

// ---------------------------------------------------------------------------
// Test 9 — x-request-id present on body-size error (413)
// ---------------------------------------------------------------------------

async function testRequestIdOnPayloadTooLarge() {
  // Send a POST with a body exceeding 1MB to trigger proxy's 413.
  // Generate a ~1.1MB JSON body to exceed the MAX_BODY_BYTES (1,048,576) limit.
  const largeBody = JSON.stringify({ data: "x".repeat(1_100_000) });
  const res = await fetch(`${BASE_URL}/api/actions`, {
    method: "POST",
    headers: {
      "x-nullspend-key": API_KEY!,
      "content-type": "application/json",
    },
    body: largeBody,
  });

  // Proxy returns 413 before the route handler runs
  assertEqual(res.status, 413, "should get 413 for oversized payload");
  const requestId = res.headers.get("x-request-id");
  assert(
    requestId !== null,
    "x-request-id header should be present on 413 proxy responses",
  );
}

// ---------------------------------------------------------------------------
// Test 10 — Authenticated API route returns x-request-id
// ---------------------------------------------------------------------------

async function testRequestIdOnAuthenticatedRoute() {
  const res = await fetch(`${BASE_URL}/api/actions?limit=1`, {
    headers: { "x-nullspend-key": API_KEY! },
  });

  assert(res.ok, `expected 200, got ${res.status}`);
  const requestId = res.headers.get("x-request-id");
  assert(
    requestId !== null,
    "x-request-id should be present on authenticated route responses",
  );
  assert(
    UUID_RE.test(requestId!),
    `x-request-id should be UUID format on authenticated route, got: ${requestId}`,
  );
}

// ---------------------------------------------------------------------------
// Test 11 — Rate limiting returns 429 with correct headers (requires Redis)
// ---------------------------------------------------------------------------

async function testRateLimiting429() {
  // Send requests rapidly to trigger the 100 req/min sliding window.
  // We send 105 requests — the last few should get 429.
  const promises: Promise<Response>[] = [];
  for (let i = 0; i < 105; i++) {
    promises.push(
      fetch(`${BASE_URL}/api/health`, {
        headers: { "x-request-id": `rate-limit-test-${i}` },
      }),
    );
  }

  const responses = await Promise.all(promises);
  const statuses = responses.map((r) => r.status);
  const got429 = statuses.some((s) => s === 429);

  if (!got429) {
    // Rate limiting might not be configured (no Upstash env vars) — skip gracefully
    const healthRes = await fetch(`${BASE_URL}/api/health?verbose=1`);
    const health = await healthRes.json();
    if (health.components?.redis?.status !== "ok") {
      console.log("(skipped — Redis/Upstash not configured)");
      return;
    }
    throw new Error(
      "Expected at least one 429 after 105 rapid requests, but got none. " +
        `Status distribution: ${JSON.stringify(statuses.reduce((acc: Record<number, number>, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {}))}`,
    );
  }

  // Verify 429 response has rate limit headers
  const rateLimitedRes = responses.find((r) => r.status === 429)!;
  assert(
    rateLimitedRes.headers.get("x-ratelimit-limit") !== null,
    "429 response should have X-RateLimit-Limit header",
  );
  assert(
    rateLimitedRes.headers.get("x-ratelimit-remaining") !== null,
    "429 response should have X-RateLimit-Remaining header",
  );
  assert(
    rateLimitedRes.headers.get("retry-after") !== null,
    "429 response should have Retry-After header",
  );

  // Verify 429 has x-request-id
  const requestId = rateLimitedRes.headers.get("x-request-id");
  assert(requestId !== null, "429 response should have x-request-id header");

  // Verify body
  const body = await rateLimitedRes.json();
  assertEqual(body.error, "Too many requests", "429 body error message");
}

// ---------------------------------------------------------------------------
// Test 12 — Rate limit 503 fail-closed (x-request-id still present)
// ---------------------------------------------------------------------------

// Note: We can't easily test the fail-closed 503 path in e2e because we'd
// need to break the Redis connection. This is verified in unit tests.
// The rate limit test above covers the live Redis → 429 path.

// ---------------------------------------------------------------------------
// Test 13 — CSRF blocks cross-origin POST
// ---------------------------------------------------------------------------

async function testCsrfBlocksCrossOrigin() {
  const res = await fetch(`${BASE_URL}/api/actions`, {
    method: "POST",
    headers: {
      "x-nullspend-key": API_KEY!,
      "content-type": "application/json",
      origin: "https://evil-site.com",
      host: "127.0.0.1:3000",
    },
    body: JSON.stringify({
      agentId: "csrf-test",
      actionType: "file_write",
      payload: {},
    }),
  });

  assertEqual(res.status, 403, "cross-origin POST should be blocked with 403");
  const body = await res.json();
  assertEqual(
    body.error,
    "Cross-origin request blocked",
    "CSRF error message",
  );

  // Verify x-request-id still present on CSRF rejection
  assert(
    res.headers.get("x-request-id") !== null,
    "CSRF 403 should have x-request-id",
  );
}

// ---------------------------------------------------------------------------
// Test 14 — CSRF allows same-origin POST
// ---------------------------------------------------------------------------

async function testCsrfAllowsSameOrigin() {
  const res = await fetch(`${BASE_URL}/api/actions`, {
    method: "POST",
    headers: {
      "x-nullspend-key": API_KEY!,
      "content-type": "application/json",
      origin: `http://127.0.0.1:3000`,
      host: "127.0.0.1:3000",
    },
    body: JSON.stringify({
      agentId: "csrf-test-same-origin",
      actionType: "file_write",
      payload: {},
    }),
  });

  // Should NOT be blocked — request proceeds to auth/handler
  assert(
    res.status !== 403 || (await res.clone().json()).error !== "Cross-origin request blocked",
    `same-origin POST should not be CSRF blocked, got ${res.status}`,
  );
}

// ---------------------------------------------------------------------------
// Test 15 — CSRF allows requests without Origin header (non-browser / SDK)
// ---------------------------------------------------------------------------

async function testCsrfAllowsNoOrigin() {
  const res = await fetch(`${BASE_URL}/api/actions`, {
    method: "POST",
    headers: {
      "x-nullspend-key": API_KEY!,
      "content-type": "application/json",
      // No origin or referer header — SDK/curl requests
    },
    body: JSON.stringify({
      agentId: "csrf-test-no-origin",
      actionType: "file_write",
      payload: {},
    }),
  });

  // Should NOT be CSRF blocked — proceeds to route handler
  assert(
    res.status !== 403 || (await res.clone().json()).error !== "Cross-origin request blocked",
    `POST without Origin should not be CSRF blocked, got ${res.status}`,
  );
}

// ---------------------------------------------------------------------------
// Test 16 — API key revocation is enforced on next request
// ---------------------------------------------------------------------------

async function testApiKeyAuthEnforcement() {
  // POST /api/actions uses API key auth (assertApiKeyWithIdentity).
  // GET /api/actions uses session auth (resolveSessionUserId) — not API key.
  //
  // In dev mode (NULLSPEND_DEV_MODE=true), session auth falls back to
  // NULLSPEND_DEV_ACTOR, so GET requests succeed regardless of API key.
  // This is intentional for local development.
  //
  // Test the API-key-auth path: POST with a bogus key should be rejected.
  const bogusKey = "ask_this_key_definitely_does_not_exist_anywhere_12345";
  const res = await fetch(`${BASE_URL}/api/actions`, {
    method: "POST",
    headers: {
      "x-nullspend-key": bogusKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      agentId: "auth-test",
      actionType: "file_write",
      payload: {},
    }),
  });

  assert(
    res.status === 401 || res.status === 403,
    `bogus API key on POST should be rejected, got ${res.status}`,
  );

  // Verify error response has x-request-id
  assert(
    res.headers.get("x-request-id") !== null,
    "auth error should have x-request-id",
  );
}

// ---------------------------------------------------------------------------
// Test 17 — Stripe webhook endpoint is exempt from rate limiting and CSRF
// ---------------------------------------------------------------------------

async function testStripeWebhookExemptions() {
  // Stripe webhooks must NOT be rate limited or CSRF blocked.
  // Send a POST without valid signature — should get 400 (bad sig), NOT 403 (CSRF).
  const res = await fetch(`${BASE_URL}/api/stripe/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://stripe.com",
      host: "127.0.0.1:3000",
    },
    body: JSON.stringify({ type: "test" }),
  });

  // Should NOT be 403 CSRF — Stripe webhooks are exempt
  assert(
    res.status !== 403,
    `Stripe webhook should be exempt from CSRF, got ${res.status}`,
  );

  // Should be 400 (missing/invalid signature) or 500 (webhook secret not set)
  assert(
    res.status === 400 || res.status === 500,
    `Stripe webhook with no sig should be 400 or 500, got ${res.status}`,
  );
}

// ---------------------------------------------------------------------------
// Test 18 — Cost events summary endpoint returns valid structure
// ---------------------------------------------------------------------------

async function testCostEventsSummaryStructure() {
  // Cost summary requires session auth — test via dev mode
  // If not in dev mode, this will return 401 which we handle gracefully
  const res = await fetch(`${BASE_URL}/api/cost-events/summary?period=7d`);

  if (res.status === 401) {
    // Session auth required, not available in this test context
    console.log("(skipped — requires session auth)");
    return;
  }

  assert(res.ok, `expected 200, got ${res.status}`);
  const body = await res.json();

  // Verify structure has expected top-level keys
  assert(body.daily !== undefined, "summary should have daily array");
  assert(body.totals !== undefined, "summary should have totals object");
  assert(
    body.totals.period === "7d",
    `totals.period should be 7d, got ${body.totals.period}`,
  );
  assert(Array.isArray(body.daily), "daily should be an array");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== NullSpend E2E Observability & Infrastructure Smoke Test ===\n");
  console.log(`  Server: ${BASE_URL}`);
  console.log("");

  // Verify the server is reachable
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (!res.ok && res.status !== 503) {
      console.error(
        `Server returned ${res.status}. Is the dev server running?`,
      );
      process.exit(1);
    }
  } catch {
    console.error(
      `Cannot reach ${BASE_URL}. Start the dev server first: pnpm dev`,
    );
    process.exit(1);
  }

  console.log("Running tests:\n");

  // Request ID propagation
  await runTest(
    "Test 1  — x-request-id present on 200",
    testRequestIdOnSuccess,
  );
  await runTest(
    "Test 2  — x-request-id unique per request",
    testRequestIdUnique,
  );
  await runTest(
    "Test 3  — x-request-id passthrough (client-provided)",
    testRequestIdPassthrough,
  );
  await runTest(
    "Test 4  — x-request-id present on 400 (invalid JSON)",
    testRequestIdOnClientError,
  );
  await runTest(
    "Test 5  — x-request-id present on 401/403 (bad API key)",
    testRequestIdOnAuthError,
  );
  await runTest(
    "Test 9  — x-request-id present on 413 (payload too large)",
    testRequestIdOnPayloadTooLarge,
  );
  await runTest(
    "Test 10 — x-request-id on authenticated route",
    testRequestIdOnAuthenticatedRoute,
  );

  // Health endpoint
  await runTest(
    "Test 6  — Health: redis component in verbose response",
    testHealthRedisComponent,
  );
  await runTest("Test 7  — Health: basic (non-verbose) response", testHealthBasic);
  await runTest(
    "Test 8  — Health: database + schema components",
    testHealthDatabaseComponents,
  );

  // CSRF protection
  await runTest(
    "Test 13 — CSRF blocks cross-origin POST",
    testCsrfBlocksCrossOrigin,
  );
  await runTest(
    "Test 14 — CSRF allows same-origin POST",
    testCsrfAllowsSameOrigin,
  );
  await runTest(
    "Test 15 — CSRF allows POST without Origin (SDK/curl)",
    testCsrfAllowsNoOrigin,
  );

  // Auth enforcement
  await runTest(
    "Test 16 — Bogus API key rejected on POST",
    testApiKeyAuthEnforcement,
  );

  // Stripe webhook exemptions
  await runTest(
    "Test 17 — Stripe webhook exempt from CSRF",
    testStripeWebhookExemptions,
  );

  // Cost events (requires session auth — skips if unavailable)
  await runTest(
    "Test 18 — Cost events summary structure",
    testCostEventsSummaryStructure,
  );

  // Rate limiting — MUST run last because it exhausts the 100 req/min window
  // and all subsequent requests from this IP will get 429 until the window resets.
  await runTest(
    "Test 11 — Rate limiting returns 429 with headers",
    testRateLimiting429,
  );

  // Summary
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (failed > 0) {
    console.log("Failed tests:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
    console.log("");
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
