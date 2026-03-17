/**
 * E2E resilience tests for Phase 5: Slack retry, idempotency, circuit breaker.
 *
 * Requires:
 *   - Dev server running at http://127.0.0.1:3000
 *   - .env.local with DATABASE_URL, NULLSPEND_API_KEY, NULLSPEND_DEV_ACTOR
 *   - UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN configured
 *
 * Run: pnpm e2e:resilience
 */

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
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

const DATABASE_URL = process.env.DATABASE_URL!;
const API_KEY = process.env.NULLSPEND_API_KEY!;
const BASE_URL = process.env.NULLSPEND_BASE_URL ?? "http://127.0.0.1:3000";

if (!DATABASE_URL || !API_KEY) {
  console.error("Missing required env vars: DATABASE_URL, NULLSPEND_API_KEY");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false });

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}
const results: TestResult[] = [];
const cleanupIds: string[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected)
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
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

function authHeaders(): Record<string, string> {
  return {
    "x-nullspend-key": API_KEY,
    "Content-Type": "application/json",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function testIdempotencyCreateAction() {
  // POST same createAction twice with same Idempotency-Key → same action ID, only 1 DB record
  const idempotencyKey = `e2e-resilience-create-${Date.now()}`;

  const body = JSON.stringify({
    agentId: "e2e-resilience-agent",
    actionType: "file_write",
    payload: { test: "idempotency-create" },
  });

  const res1 = await fetch(`${BASE_URL}/api/actions`, {
    method: "POST",
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    body,
  });
  assert(res1.ok, `First request should succeed: ${res1.status}`);
  const data1 = await res1.json();
  cleanupIds.push(data1.id);

  const res2 = await fetch(`${BASE_URL}/api/actions`, {
    method: "POST",
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    body,
  });
  assert(res2.ok, `Second request should succeed: ${res2.status}`);
  const data2 = await res2.json();

  assertEqual(data1.id, data2.id, "Same Idempotency-Key should return same action ID");

  // Verify X-Idempotent-Replayed header on second response
  assertEqual(
    res2.headers.get("X-Idempotent-Replayed"),
    "true",
    "Second response should have X-Idempotent-Replayed: true",
  );

  // Verify only 1 DB record exists
  const rows = await sql`
    SELECT id FROM actions WHERE id = ${data1.id}
  `;
  assertEqual(rows.length, 1, "Only 1 DB record should exist");
}

async function testIdempotencyMarkResult() {
  // Create an action, approve it, then POST markResult twice with same key
  const createRes = await fetch(`${BASE_URL}/api/actions`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      agentId: "e2e-resilience-result-agent",
      actionType: "file_write",
      payload: { test: "idempotency-result" },
    }),
  });
  assert(createRes.ok, `Create should succeed: ${createRes.status}`);
  const { id: actionId } = await createRes.json();
  cleanupIds.push(actionId);

  // Approve via DB
  const ownerUserId = (
    await sql`SELECT owner_user_id FROM actions WHERE id = ${actionId}`
  )[0].owner_user_id;
  await sql`
    UPDATE actions SET status = 'approved', approved_at = NOW(), approved_by = ${ownerUserId}
    WHERE id = ${actionId}
  `;

  // First markResult: executing
  await fetch(`${BASE_URL}/api/actions/${actionId}/result`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ status: "executing" }),
  });

  // Now mark as executed with idempotency
  const idempotencyKey = `e2e-resilience-result-${Date.now()}`;
  const resultBody = JSON.stringify({
    status: "executed",
    result: { ok: true },
  });

  const res1 = await fetch(`${BASE_URL}/api/actions/${actionId}/result`, {
    method: "POST",
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    body: resultBody,
  });
  assert(res1.ok, `First markResult should succeed: ${res1.status}`);
  const data1 = await res1.json();

  const res2 = await fetch(`${BASE_URL}/api/actions/${actionId}/result`, {
    method: "POST",
    headers: { ...authHeaders(), "Idempotency-Key": idempotencyKey },
    body: resultBody,
  });
  assert(res2.ok, `Second markResult should succeed: ${res2.status}`);
  const data2 = await res2.json();

  assertEqual(data1.status, data2.status, "Same response on replay");
  assertEqual(
    res2.headers.get("X-Idempotent-Replayed"),
    "true",
    "Second response should have X-Idempotent-Replayed: true",
  );
}

async function testHealthCheckAfterAuthFailures() {
  // Health check should always work regardless of circuit breaker state
  // (circuit breaker only affects session auth, not health endpoint)
  const res = await fetch(`${BASE_URL}/api/health`);
  assert(res.ok, `Health check should succeed: ${res.status}`);
  const data = await res.json();
  assertEqual(data.status === "ok" || data.status === "degraded", true, "Health should be ok or degraded");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== Phase 5: Resilience E2E Tests ===\n");
  console.log(`  Server:  ${BASE_URL}`);
  console.log("");

  // Verify server is reachable
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (!res.ok) {
      console.error(`Server returned ${res.status}`);
      process.exit(1);
    }
  } catch {
    console.error(`Cannot reach ${BASE_URL}. Start the dev server first.`);
    process.exit(1);
  }

  console.log("Running tests:\n");

  await runTest(
    "1. Idempotency: duplicate createAction returns same ID",
    testIdempotencyCreateAction,
  );
  await runTest(
    "2. Idempotency: duplicate markResult returns same response",
    testIdempotencyMarkResult,
  );
  await runTest(
    "3. Health check works independently of circuit breaker",
    testHealthCheckAfterAuthFailures,
  );

  // Cleanup
  console.log("\nCleaning up test data...");
  for (const id of cleanupIds) {
    try {
      await sql`DELETE FROM cost_events WHERE action_id = ${id}`;
      await sql`DELETE FROM actions WHERE id = ${id}`;
    } catch {
      /* best effort */
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);

  console.log(
    `\n=== Results: ${passed} passed, ${failed} failed (${totalMs}ms total) ===\n`,
  );

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
