/**
 * Stress test for SDK retry, idempotency, and new config features.
 *
 * Exercises the SDK against the live dev server to verify:
 * - Retry logic doesn't break happy-path requests
 * - Idempotency keys are sent on every POST (visible via server logs)
 * - onRetry callback fires on transient failures
 * - maxRetryTimeMs caps total retry duration
 * - requestTimeoutMs NaN/Infinity fallback works in practice
 * - Concurrent requests with retries don't interfere
 * - proposeAndWait with retry-enabled client works end-to-end
 *
 * Requires:
 *   - Dev server running at http://127.0.0.1:3000
 *   - .env.local with DATABASE_URL, NULLSPEND_API_KEY, NULLSPEND_DEV_ACTOR
 *
 * Run: pnpm tsx scripts/e2e-sdk-retry-stress.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { NullSpend, NullSpendError } from "@nullspend/sdk";

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
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

const DATABASE_URL = process.env.DATABASE_URL!;
const API_KEY = process.env.NULLSPEND_API_KEY!;
const DEV_ACTOR = process.env.NULLSPEND_DEV_ACTOR!;
const BASE_URL = process.env.NULLSPEND_BASE_URL ?? "http://127.0.0.1:3000";

if (!DATABASE_URL || !API_KEY || !DEV_ACTOR) {
  console.error("Missing required env vars: DATABASE_URL, NULLSPEND_API_KEY, NULLSPEND_DEV_ACTOR");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false });

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface TestResult { name: string; passed: boolean; error?: string; durationMs: number }
const results: TestResult[] = [];
const cleanupIds: string[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected)
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function runTest(name: string, fn: () => Promise<void>) {
  process.stdout.write(`  ${name} ... `);
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    results.push({ name, passed: true, durationMs: ms });
    console.log(`PASS (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, error: message, durationMs: ms });
    console.log(`FAIL (${ms}ms)`);
    console.log(`    ${message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dbApproveAction(actionId: string, ownerUserId: string) {
  const rows = await sql`
    UPDATE actions
    SET status = 'approved', approved_at = NOW(), approved_by = ${ownerUserId}
    WHERE id = ${actionId} AND owner_user_id = ${ownerUserId} AND status = 'pending'
    RETURNING id, status
  `;
  if (rows.length === 0) throw new Error(`Failed to approve ${actionId}`);
  return rows[0];
}

async function dbDeleteAction(actionId: string) {
  await sql`DELETE FROM actions WHERE id = ${actionId}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testDefaultRetryHappyPath() {
  // Default maxRetries=2 should not interfere with normal requests
  const sdk = new NullSpend({ baseUrl: BASE_URL, apiKey: API_KEY });
  const created = await sdk.createAction({
    agentId: "stress-retry-agent",
    actionType: "file_write",
    payload: { test: "default-retry-happy-path" },
  });
  cleanupIds.push(created.id);
  assertEqual(created.status, "pending", "status");

  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.status, "pending", "fetched status");
  assertEqual(fetched.agentId, "stress-retry-agent", "agentId preserved");
}

async function testOnRetryNotCalledOnSuccess() {
  const onRetryCalls: unknown[] = [];
  const sdk = new NullSpend({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    maxRetries: 3,
    onRetry: (info) => { onRetryCalls.push(info); },
  });

  const created = await sdk.createAction({
    agentId: "stress-onretry-agent",
    actionType: "file_write",
    payload: { test: "onretry-not-called" },
  });
  cleanupIds.push(created.id);

  assertEqual(onRetryCalls.length, 0, "onRetry should not be called on success");
}

async function testRetryWithBadBaseUrl() {
  // Point to a non-existent server — should retry then fail
  const onRetryCalls: Array<{ attempt: number; delayMs: number; method: string; path: string }> = [];
  const sdk = new NullSpend({
    baseUrl: "http://127.0.0.1:19999", // nothing listening here
    apiKey: API_KEY,
    maxRetries: 2,
    retryBaseDelayMs: 50, // fast retries for the test
    onRetry: (info) => {
      onRetryCalls.push({
        attempt: info.attempt,
        delayMs: info.delayMs,
        method: info.method,
        path: info.path,
      });
    },
  });

  let threw = false;
  try {
    await sdk.getAction("fake-id");
  } catch (err) {
    threw = true;
    assert(err instanceof NullSpendError, "should be NullSpendError");
    assert(err.message.includes("network error"), `message should contain 'network error': ${err.message}`);
  }
  assert(threw, "should throw on unreachable server");
  assertEqual(onRetryCalls.length, 2, "onRetry should be called twice (2 retries)");
  assertEqual(onRetryCalls[0].attempt, 0, "first retry attempt=0");
  assertEqual(onRetryCalls[1].attempt, 1, "second retry attempt=1");
  assertEqual(onRetryCalls[0].method, "GET", "method should be GET");
  assert(onRetryCalls[0].path.includes("/api/actions/"), "path should contain /api/actions/");
  assert(onRetryCalls[0].delayMs >= 1, "delay should be >= 1ms");
}

async function testOnRetryAbort() {
  const sdk = new NullSpend({
    baseUrl: "http://127.0.0.1:19999",
    apiKey: API_KEY,
    maxRetries: 5,
    retryBaseDelayMs: 50,
    onRetry: () => false, // abort immediately
  });

  const start = Date.now();
  let threw = false;
  try {
    await sdk.getAction("fake-id");
  } catch {
    threw = true;
  }
  const elapsed = Date.now() - start;

  assert(threw, "should throw");
  // With 5 retries at 50ms+ base delay, if abort didn't work it would take >250ms
  // With abort, only 1 attempt + 1 onRetry call, should be well under 2000ms
  assert(elapsed < 2000, `should abort quickly, took ${elapsed}ms`);
}

async function testMaxRetryTimeMsCap() {
  const onRetryCalls: number[] = [];
  const sdk = new NullSpend({
    baseUrl: "http://127.0.0.1:19999",
    apiKey: API_KEY,
    maxRetries: 10, // lots of retries allowed
    retryBaseDelayMs: 100,
    maxRetryTimeMs: 500, // but cap total time at 500ms
    onRetry: (info) => { onRetryCalls.push(info.attempt); },
  });

  const start = Date.now();
  let threw = false;
  try {
    await sdk.getAction("fake-id");
  } catch {
    threw = true;
  }
  const elapsed = Date.now() - start;

  assert(threw, "should throw");
  // Should have been capped well before 10 retries
  assert(onRetryCalls.length < 8, `should have fewer than 8 retries, got ${onRetryCalls.length}`);
  // Total time should be roughly bounded by maxRetryTimeMs + overhead
  assert(elapsed < 3000, `should complete within ~3s, took ${elapsed}ms`);
}

async function testRequestTimeoutNaN() {
  // NaN should fall back to default 30s timeout — requests should work normally
  const sdk = new NullSpend({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    requestTimeoutMs: NaN,
    maxRetries: 0,
  });

  const created = await sdk.createAction({
    agentId: "stress-nan-timeout",
    actionType: "file_write",
    payload: { test: "nan-timeout" },
  });
  cleanupIds.push(created.id);
  assertEqual(created.status, "pending", "should work with NaN timeout");
}

async function testRequestTimeoutInfinity() {
  // Infinity should fall back to default 30s timeout — requests should work
  const sdk = new NullSpend({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    requestTimeoutMs: Infinity,
    maxRetries: 0,
  });

  const created = await sdk.createAction({
    agentId: "stress-inf-timeout",
    actionType: "file_write",
    payload: { test: "infinity-timeout" },
  });
  cleanupIds.push(created.id);
  assertEqual(created.status, "pending", "should work with Infinity timeout");
}

async function testConcurrentRequestsWithRetry() {
  const sdk = new NullSpend({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    maxRetries: 2,
  });

  // Fire 10 concurrent createAction calls
  const promises = Array.from({ length: 10 }, (_, i) =>
    sdk.createAction({
      agentId: `stress-concurrent-${i}`,
      actionType: "file_write",
      payload: { index: i, test: "concurrent-retry" },
    }),
  );

  const results = await Promise.all(promises);
  for (const r of results) {
    cleanupIds.push(r.id);
    assertEqual(r.status, "pending", "each concurrent action should be pending");
  }

  // Verify all have unique IDs
  const ids = new Set(results.map((r) => r.id));
  assertEqual(ids.size, 10, "all 10 actions should have unique IDs");
}

async function testIdempotencyKeysSentToServer() {
  // We can't directly inspect headers on the server, but we can verify
  // the SDK doesn't crash when sending them and the server accepts them
  const sdk = new NullSpend({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    maxRetries: 0,
  });

  // POST requests should include Idempotency-Key
  const created = await sdk.createAction({
    agentId: "stress-idem-agent",
    actionType: "file_write",
    payload: { test: "idempotency-key" },
  });
  cleanupIds.push(created.id);

  // markResult is also a POST
  await dbApproveAction(created.id, DEV_ACTOR);
  await sdk.markResult(created.id, { status: "executing" });
  await sdk.markResult(created.id, { status: "executed", result: { ok: true } });

  const final = await sdk.getAction(created.id);
  assertEqual(final.status, "executed", "full lifecycle with idempotency keys should work");
}

async function testProposeAndWaitWithRetryClient() {
  const onRetryCalls: unknown[] = [];
  const sdk = new NullSpend({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    maxRetries: 2,
    onRetry: (info) => { onRetryCalls.push(info); },
  });

  const resultPromise = sdk.proposeAndWait<{ computed: number }>({
    agentId: "stress-paw-retry",
    actionType: "http_post",
    payload: { expression: "6*7" },
    metadata: { test: "paw-retry" },
    pollIntervalMs: 300,
    timeoutMs: 30_000,
    execute: async (ctx) => {
      assert(!!ctx?.actionId, "execute should receive actionId");
      return { computed: 42 };
    },
  });

  // Approve in parallel
  let approved = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    const pending = await sql`
      SELECT id FROM actions
      WHERE agent_id = 'stress-paw-retry'
        AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1
    `;
    if (pending.length > 0) {
      cleanupIds.push(pending[0].id);
      await dbApproveAction(pending[0].id, DEV_ACTOR);
      approved = true;
      break;
    }
  }
  assert(approved, "should find and approve the pending action");

  const result = await resultPromise;
  assertEqual(result.computed, 42, "proposeAndWait result");
  // No retries should have fired (server is healthy)
  assertEqual(onRetryCalls.length, 0, "no retries on healthy server");
}

async function testRapidFireCreateAndGet() {
  // Rapid sequence of create → get → create → get to stress the retry loop
  const sdk = new NullSpend({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    maxRetries: 2,
    retryBaseDelayMs: 100,
  });

  for (let i = 0; i < 8; i++) {
    const created = await sdk.createAction({
      agentId: `stress-rapid-${i}`,
      actionType: "send_email",
      payload: { iteration: i, test: "rapid-fire" },
    });
    cleanupIds.push(created.id);

    const fetched = await sdk.getAction(created.id);
    assertEqual(fetched.id, created.id, `round-trip ${i} id`);
    assertEqual(fetched.agentId, `stress-rapid-${i}`, `round-trip ${i} agentId`);
  }
}

async function testRetryDelayProgression() {
  // Verify delays increase by observing timestamps
  const retryTimestamps: number[] = [];
  const sdk = new NullSpend({
    baseUrl: "http://127.0.0.1:19999",
    apiKey: API_KEY,
    maxRetries: 3,
    retryBaseDelayMs: 50,
    onRetry: () => { retryTimestamps.push(Date.now()); },
  });

  const start = Date.now();
  try { await sdk.getAction("fake"); } catch { /* expected */ }

  assert(retryTimestamps.length >= 2, `need at least 2 retries, got ${retryTimestamps.length}`);

  // First gap should be smaller than second gap (exponential backoff with jitter)
  // We can't be exact due to jitter, but the total should be reasonable
  const totalRetryTime = retryTimestamps[retryTimestamps.length - 1] - start;
  assert(totalRetryTime > 50, `total retry time should be > 50ms, got ${totalRetryTime}ms`);
  assert(totalRetryTime < 5000, `total retry time should be < 5s, got ${totalRetryTime}ms`);
}

async function testZeroRetriesNoDelay() {
  // maxRetries: 0 should fail immediately with no delay
  const sdk = new NullSpend({
    baseUrl: "http://127.0.0.1:19999",
    apiKey: API_KEY,
    maxRetries: 0,
    retryBaseDelayMs: 5000, // would be slow if it retried
  });

  const start = Date.now();
  try { await sdk.getAction("fake"); } catch { /* expected */ }
  const elapsed = Date.now() - start;

  // Should fail in well under 2s (just one connection attempt)
  assert(elapsed < 2000, `should fail fast with 0 retries, took ${elapsed}ms`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== SDK Retry & Idempotency Stress Test ===\n");
  console.log(`  Server:  ${BASE_URL}`);
  console.log(`  Actor:   ${DEV_ACTOR}`);
  console.log("");

  // Verify server is reachable
  try {
    const res = await fetch(`${BASE_URL}/api/actions?limit=1`, {
      headers: { "x-nullspend-key": API_KEY },
    });
    if (!res.ok) { console.error(`Server returned ${res.status}`); process.exit(1); }
  } catch {
    console.error(`Cannot reach ${BASE_URL}. Start the dev server first.`);
    process.exit(1);
  }

  console.log("Running tests:\n");

  // Happy-path with retry-enabled client
  await runTest("Default retry config — happy path", testDefaultRetryHappyPath);
  await runTest("onRetry not called on success", testOnRetryNotCalledOnSuccess);
  await runTest("Idempotency keys accepted by server", testIdempotencyKeysSentToServer);
  await runTest("requestTimeoutMs: NaN → default fallback", testRequestTimeoutNaN);
  await runTest("requestTimeoutMs: Infinity → default fallback", testRequestTimeoutInfinity);

  // Retry behavior with unreachable server
  await runTest("Retry with unreachable server + onRetry callback", testRetryWithBadBaseUrl);
  await runTest("onRetry returning false aborts retry", testOnRetryAbort);
  await runTest("maxRetryTimeMs caps total retry duration", testMaxRetryTimeMsCap);
  await runTest("Retry delay progression (exponential backoff)", testRetryDelayProgression);
  await runTest("Zero retries — fail immediately", testZeroRetriesNoDelay);

  // Concurrency & throughput
  await runTest("10 concurrent requests with retry", testConcurrentRequestsWithRetry);
  await runTest("8 rapid-fire create+get round-trips", testRapidFireCreateAndGet);

  // Cooldown — let rate limiter window reset
  process.stdout.write("  (cooldown 5s for rate limiter reset)...\n");
  await sleep(5000);

  // Full lifecycle
  await runTest("proposeAndWait with retry-enabled client", testProposeAndWaitWithRetryClient);

  // Cleanup
  console.log("\nCleaning up test data...");
  for (const id of cleanupIds) {
    try { await dbDeleteAction(id); } catch { /* best effort */ }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed (${totalMs}ms total) ===\n`);

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

main().catch((err) => {
  console.error("\nFatal error:", err);
  sql.end().finally(() => process.exit(1));
});
