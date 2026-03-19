/**
 * End-to-end auth hardening test for the NullSpend dashboard (Phase 2).
 *
 * Verifies:
 *   - Cache-Control headers on API responses (2.3)
 *   - Cross-tenant isolation between API keys (2.2)
 *   - Per-key rate limiting distinct from per-IP (2.1)
 *
 * Requires:
 *   - Dev server running at http://127.0.0.1:3000 (or NULLSPEND_BASE_URL)
 *   - DATABASE_URL in .env.local
 *
 * Run: pnpm e2e:auth
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

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
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false });

// ---------------------------------------------------------------------------
// Test users and keys
// ---------------------------------------------------------------------------

const USER_A = "e2e-tenant-a-" + Date.now();
const USER_B = "e2e-tenant-b-" + Date.now();
const RAW_KEY_A = "ns_live_sk_" + randomBytes(16).toString("hex");
const RAW_KEY_B = "ns_live_sk_" + randomBytes(16).toString("hex");
const HASH_A = createHash("sha256").update(RAW_KEY_A).digest("hex");
const HASH_B = createHash("sha256").update(RAW_KEY_B).digest("hex");

let _KEY_ID_A: string;
let _KEY_ID_B: string;

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

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
// Helpers
// ---------------------------------------------------------------------------

function apiHeaders(rawKey: string): Record<string, string> {
  return {
    "x-nullspend-key": rawKey,
    "content-type": "application/json",
  };
}

async function createActionForUser(
  rawKey: string,
  agentId: string,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/actions`, {
    method: "POST",
    headers: apiHeaders(rawKey),
    body: JSON.stringify({
      agentId,
      actionType: "file_write",
      payload: { path: "/tmp/e2e-auth-test.txt" },
      metadata,
      expiresInSeconds: 0,
    }),
  });
  if (res.status !== 201) {
    const text = await res.text();
    throw new Error(`create action failed: ${res.status} ${text}`);
  }
  const body = await res.json();
  return body.id;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

async function setup() {
  const [rowA] = await sql`
    INSERT INTO api_keys (user_id, name, key_hash, key_prefix)
    VALUES (${USER_A}, 'e2e-key-a', ${HASH_A}, ${RAW_KEY_A.slice(0, 12)})
    RETURNING id
  `;
  _KEY_ID_A = rowA.id;

  const [rowB] = await sql`
    INSERT INTO api_keys (user_id, name, key_hash, key_prefix)
    VALUES (${USER_B}, 'e2e-key-b', ${HASH_B}, ${RAW_KEY_B.slice(0, 12)})
    RETURNING id
  `;
  _KEY_ID_B = rowB.id;
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

async function teardown() {
  await sql`DELETE FROM cost_events WHERE user_id IN (${USER_A}, ${USER_B})`;
  await sql`DELETE FROM actions WHERE owner_user_id IN (${USER_A}, ${USER_B})`;
  await sql`DELETE FROM tool_costs WHERE user_id IN (${USER_A}, ${USER_B})`;
  await sql`DELETE FROM api_keys WHERE user_id IN (${USER_A}, ${USER_B})`;
}

// ---------------------------------------------------------------------------
// Cache-Control tests (2.3)
// ---------------------------------------------------------------------------

async function testCacheControlOnApiResponse() {
  const res = await fetch(`${BASE_URL}/api/auth/introspect`, {
    headers: apiHeaders(RAW_KEY_A),
  });
  assert(res.ok, `expected 200, got ${res.status}`);
  assertEqual(
    res.headers.get("cache-control"),
    "private, no-store",
    "API response should have Cache-Control: private, no-store",
  );
}

async function testVaryCookieOnApiResponse() {
  const res = await fetch(`${BASE_URL}/api/auth/introspect`, {
    headers: apiHeaders(RAW_KEY_A),
  });
  assert(res.ok, `expected 200, got ${res.status}`);
  const vary = res.headers.get("vary");
  assert(
    vary !== null && vary.includes("Cookie"),
    `API response should have Vary containing Cookie, got: ${vary}`,
  );
}

async function testRateLimitHeadersOnSuccess() {
  const res = await fetch(`${BASE_URL}/api/auth/introspect`, {
    headers: apiHeaders(RAW_KEY_A),
  });
  assert(res.ok, `expected 200, got ${res.status}`);
  // Success responses from Pattern A routes should carry X-RateLimit-* headers
  // when per-key rate limiting is active (Upstash configured)
  const limit = res.headers.get("x-ratelimit-limit");
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (limit === null && remaining === null) {
    // Per-key rate limiting not active (no Upstash) — skip gracefully
    const healthRes = await fetch(`${BASE_URL}/api/health?verbose=1`);
    const health = await healthRes.json();
    if (health.components?.redis?.status !== "ok") {
      console.log("(skipped — Redis/Upstash not configured)");
      return;
    }
    throw new Error("Expected X-RateLimit-* headers on success response, but none found");
  }
  assertEqual(limit, "60", "X-RateLimit-Limit should be 60 on success response");
  assert(remaining !== null, "X-RateLimit-Remaining should be present on success response");
  assert(
    Number(remaining) >= 0 && Number(remaining) <= 60,
    `X-RateLimit-Remaining should be 0-60, got: ${remaining}`,
  );
}

// ---------------------------------------------------------------------------
// Cross-tenant isolation tests (2.2)
// ---------------------------------------------------------------------------

async function testCrossTenantActionRead() {
  const actionId = await createActionForUser(RAW_KEY_A, "agent-tenant-a", { test: "cross-tenant-read" });

  // User B tries to GET the action owned by User A
  const res = await fetch(`${BASE_URL}/api/actions/${actionId}`, {
    headers: apiHeaders(RAW_KEY_B),
  });
  assertEqual(res.status, 404, "User B should get 404 for User A's action");
}

async function testCrossTenantActionResult() {
  const actionId = await createActionForUser(RAW_KEY_A, "agent-tenant-a", { test: "cross-tenant-result" });

  // Approve via DB
  await sql`
    UPDATE actions
    SET status = 'approved', approved_at = NOW(), approved_by = ${USER_A}
    WHERE id = ${actionId} AND owner_user_id = ${USER_A} AND status = 'pending'
  `;

  // User B tries to POST result to User A's action
  const res = await fetch(`${BASE_URL}/api/actions/${actionId}/result`, {
    method: "POST",
    headers: apiHeaders(RAW_KEY_B),
    body: JSON.stringify({ status: "executing" }),
  });
  assertEqual(res.status, 404, "User B should get 404 when posting result to User A's action");
}

async function testCrossTenantIntrospect() {
  const resA = await fetch(`${BASE_URL}/api/auth/introspect`, {
    headers: apiHeaders(RAW_KEY_A),
  });
  assert(resA.ok, `User A introspect failed: ${resA.status}`);
  const bodyA = await resA.json();
  assertEqual(bodyA.userId, USER_A, "User A should see their own userId");

  const resB = await fetch(`${BASE_URL}/api/auth/introspect`, {
    headers: apiHeaders(RAW_KEY_B),
  });
  assert(resB.ok, `User B introspect failed: ${resB.status}`);
  const bodyB = await resB.json();
  assertEqual(bodyB.userId, USER_B, "User B should see their own userId");
}

async function testCrossTenantToolCosts() {
  // User A discovers a tool
  const discoverRes = await fetch(`${BASE_URL}/api/tool-costs/discover`, {
    method: "POST",
    headers: apiHeaders(RAW_KEY_A),
    body: JSON.stringify({
      serverName: "e2e-test-server",
      tools: [{ name: "e2e-tool-a", tierCost: 100 }],
    }),
  });
  assertEqual(discoverRes.status, 201, "User A tool discover should succeed");

  // User B lists their tool costs — should NOT see User A's tools
  const res = await fetch(`${BASE_URL}/api/tool-costs`, {
    headers: apiHeaders(RAW_KEY_B),
  });
  assert(res.ok, `User B tool-costs GET failed: ${res.status}`);
  const body = await res.json();
  const userATools = (body.data ?? []).filter(
    (t: { serverName?: string; toolName?: string }) =>
      t.serverName === "e2e-test-server" && t.toolName === "e2e-tool-a",
  );
  assertEqual(userATools.length, 0, "User B should not see User A's discovered tools");
}

// ---------------------------------------------------------------------------
// Per-key rate limiting tests (2.1) — RUN LAST
// ---------------------------------------------------------------------------

async function testPerKeyRateLimit() {
  // Send requests sequentially with Key A, checking X-RateLimit-Remaining header.
  // Stop when 429 is received.
  let got429 = false;
  let lastLimit = "";
  let requestCount = 0;

  for (let i = 0; i < 70; i++) {
    requestCount++;
    const res = await fetch(`${BASE_URL}/api/auth/introspect`, {
      headers: apiHeaders(RAW_KEY_A),
    });

    if (res.status === 429) {
      got429 = true;
      lastLimit = res.headers.get("x-ratelimit-limit") ?? "";
      break;
    }

    // If we see per-key rate limit headers, track them
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining !== null && parseInt(remaining) <= 1) {
      // Next request should trigger 429
    }
  }

  if (!got429) {
    // Per-key rate limiting might not be configured (no Upstash) — skip
    const healthRes = await fetch(`${BASE_URL}/api/health?verbose=1`);
    const health = await healthRes.json();
    if (health.components?.redis?.status !== "ok") {
      console.log("(skipped — Redis/Upstash not configured)");
      return;
    }
    throw new Error(
      `Expected 429 from per-key rate limit after ${requestCount} requests, but got none. ` +
      "Per-key rate limiter may not be active.",
    );
  }

  // Verify the limit is 60 (per-key default), not 100 (per-IP)
  assertEqual(lastLimit, "60", "X-RateLimit-Limit should be 60 (per-key), not 100 (per-IP)");
}

async function testPerKeyIsolation() {
  // After Key A is exhausted above, Key B should still work
  const res = await fetch(`${BASE_URL}/api/auth/introspect`, {
    headers: apiHeaders(RAW_KEY_B),
  });

  if (res.status === 429) {
    // Could be per-IP rate limit from prior e2e tests — check
    const limit = res.headers.get("x-ratelimit-limit");
    if (limit === "100") {
      console.log("(skipped — hit per-IP rate limit, not per-key)");
      return;
    }
    throw new Error(
      "Key B got 429 even though only Key A was exhausted. " +
      `X-RateLimit-Limit: ${limit}`,
    );
  }

  assert(res.ok, `Key B should succeed after Key A is exhausted, got ${res.status}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== NullSpend E2E Auth Hardening Test (Phase 2) ===\n");
  console.log(`  Server: ${BASE_URL}`);
  console.log(`  User A: ${USER_A}`);
  console.log(`  User B: ${USER_B}`);
  console.log("");

  // Verify the server is reachable and per-IP rate limit is not already exhausted
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "60");
      const waitSec = Math.min(retryAfter, 65);
      console.log(`  Per-IP rate limit active (429). Waiting ${waitSec}s for window to reset...`);
      await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
      // Verify again after wait
      const retryRes = await fetch(`${BASE_URL}/api/health`);
      if (retryRes.status === 429) {
        console.error("Per-IP rate limit still active after wait. Try again later.");
        process.exit(1);
      }
    } else if (!res.ok && res.status !== 503) {
      console.error(`Server returned ${res.status}. Is the dev server running?`);
      process.exit(1);
    }
  } catch {
    console.error(
      `Cannot reach ${BASE_URL}. Start the dev server first: pnpm dev`,
    );
    process.exit(1);
  }

  // Setup test data
  console.log("Setting up test users and API keys...\n");
  await setup();

  console.log("Running tests:\n");

  // Cache-Control (2.3)
  await runTest(
    "Test 1 — API response has Cache-Control: private, no-store",
    testCacheControlOnApiResponse,
  );
  await runTest(
    "Test 2 — API response has Vary: Cookie",
    testVaryCookieOnApiResponse,
  );

  // Rate limit headers on success (2.1)
  await runTest(
    "Test 3 — Success response carries X-RateLimit-* headers",
    testRateLimitHeadersOnSuccess,
  );

  // Cross-tenant isolation (2.2)
  await runTest(
    "Test 4 — User B cannot read User A's action",
    testCrossTenantActionRead,
  );
  await runTest(
    "Test 5 — User B cannot post result to User A's action",
    testCrossTenantActionResult,
  );
  await runTest(
    "Test 6 — Each user introspects their own identity",
    testCrossTenantIntrospect,
  );
  await runTest(
    "Test 7 — User B cannot see User A's discovered tools",
    testCrossTenantToolCosts,
  );

  // Per-key rate limiting (2.1) — MUST run last (exhausts Key A)
  await runTest(
    "Test 8 — Per-key rate limit triggers 429 at limit=60",
    testPerKeyRateLimit,
  );
  await runTest(
    "Test 9 — Key B succeeds after Key A is exhausted",
    testPerKeyIsolation,
  );

  // Teardown
  console.log("\nCleaning up test data...");
  await teardown();

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

  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("\nFatal error:", err);
  // Best-effort cleanup
  try { await teardown(); } catch { /* ignore */ }
  await sql.end().catch(() => {});
  process.exit(1);
});
