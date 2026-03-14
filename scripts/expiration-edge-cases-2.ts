/**
 * Second wave of edge-case experiments — deeper boundary conditions.
 *
 * Run: pnpm tsx scripts/expiration-edge-cases-2.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { NullSpend } from "@nullspend/sdk";

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

const DATABASE_URL = process.env.DATABASE_URL!;
const API_KEY = process.env.NULLSPEND_API_KEY!;
const BASE_URL = process.env.NULLSPEND_BASE_URL ?? "http://127.0.0.1:3000";

const sql = postgres(DATABASE_URL, { prepare: false });
const sdk = new NullSpend({ baseUrl: BASE_URL, apiKey: API_KEY });

const cleanupIds: string[] = [];

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
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dbDeleteAction(actionId: string) {
  await sql`DELETE FROM actions WHERE id = ${actionId}`;
}

// ---------------------------------------------------------------------------
// Exp 11: expiresInSeconds: 0 means never expire (distinct from null)
// ---------------------------------------------------------------------------

async function testZeroExpiresInSeconds() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: 0,
  });
  cleanupIds.push(created.id);

  assertEqual(created.expiresAt, null, "expiresAt should be null for 0 input");

  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.status, "pending", "should still be pending");
  assertEqual(fetched.expiresAt, null, "expiresAt should stay null in getAction");
}

// ---------------------------------------------------------------------------
// Exp 12: Approved action is immune to expiration
// ---------------------------------------------------------------------------

async function testApprovedActionImmune() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: 1,
  });
  cleanupIds.push(created.id);

  // Immediately approve via direct DB (bypass the session auth)
  await sql`
    UPDATE actions
    SET status = 'approved', approved_at = NOW(), approved_by = 'test-user'
    WHERE id = ${created.id} AND status = 'pending'
  `;

  await sleep(3000);

  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.status, "approved", "approved action should NOT be expired");
}

// ---------------------------------------------------------------------------
// Exp 13: Rejected action is immune to expiration
// ---------------------------------------------------------------------------

async function testRejectedActionImmune() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: 1,
  });
  cleanupIds.push(created.id);

  await sql`
    UPDATE actions
    SET status = 'rejected', rejected_at = NOW(), rejected_by = 'test-user'
    WHERE id = ${created.id} AND status = 'pending'
  `;

  await sleep(3000);

  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.status, "rejected", "rejected action should NOT be expired");
}

// ---------------------------------------------------------------------------
// Exp 14: expiredAt is set when action expires via getAction
// ---------------------------------------------------------------------------

async function testExpiredAtTimestamp() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: 1,
  });
  cleanupIds.push(created.id);

  await sleep(3000);

  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.status, "expired", "should be expired");
  assert(fetched.expiredAt !== null, "expiredAt should be set");

  const expiredDate = new Date(fetched.expiredAt!);
  const ageMs = Math.abs(Date.now() - expiredDate.getTime());
  assert(ageMs < 30_000, `expiredAt should be recent, got age ${ageMs}ms`);
}

// ---------------------------------------------------------------------------
// Exp 15: Double getAction on expired action is idempotent
// ---------------------------------------------------------------------------

async function testDoubleExpireIdempotent() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: 1,
  });
  cleanupIds.push(created.id);

  await sleep(3000);

  const first = await sdk.getAction(created.id);
  const second = await sdk.getAction(created.id);

  assertEqual(first.status, "expired", "first call: expired");
  assertEqual(second.status, "expired", "second call: expired");
  assertEqual(first.expiredAt, second.expiredAt, "expiredAt should be the same both times");
}

// ---------------------------------------------------------------------------
// Exp 16: Reject an expired action via HTTP returns 409
// ---------------------------------------------------------------------------

async function testRejectExpiredAction409() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: 1,
  });
  cleanupIds.push(created.id);

  await sleep(3000);

  // Trigger lazy expiration
  await sdk.getAction(created.id);

  // Try to reject via HTTP
  const response = await fetch(`${BASE_URL}/api/actions/${created.id}/reject`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nullspend-key": API_KEY,
      cookie: "nullspend-dev-actor=dev-user",
    },
    body: JSON.stringify({}),
  });

  assertEqual(response.status, 409, "reject on expired action should return 409");
  const body = await response.json() as { error: string };
  assert(body.error.includes("expired"), "error message should mention expired");
}

// ---------------------------------------------------------------------------
// Exp 17: Approve an expired action via HTTP returns 409
// ---------------------------------------------------------------------------

async function testApproveExpiredAction409() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: 1,
  });
  cleanupIds.push(created.id);

  await sleep(3000);

  // Trigger lazy expiration
  await sdk.getAction(created.id);

  // Try to approve via HTTP
  const response = await fetch(`${BASE_URL}/api/actions/${created.id}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-nullspend-key": API_KEY,
      cookie: "nullspend-dev-actor=dev-user",
    },
    body: JSON.stringify({}),
  });

  assertEqual(response.status, 409, "approve on expired action should return 409");
  const body = await response.json() as { error: string };
  assert(body.error.includes("expired"), "error message should mention expired");
}

// ---------------------------------------------------------------------------
// Exp 18: Bulk expire only touches expired actions, not never-expire ones
// ---------------------------------------------------------------------------

async function testBulkExpireSelectivity() {
  const neverExpire = await sdk.createAction({
    agentId: "edge-test-bulk-never",
    actionType: "file_write",
    payload: { case: "never-expire" },
    expiresInSeconds: 0,
  });
  cleanupIds.push(neverExpire.id);

  const willExpire = await sdk.createAction({
    agentId: "edge-test-bulk-expire",
    actionType: "file_write",
    payload: { case: "will-expire" },
    expiresInSeconds: 1,
  });
  cleanupIds.push(willExpire.id);

  await sleep(3000);

  // List actions triggers bulkExpireActions
  const response = await fetch(`${BASE_URL}/api/actions?limit=50`, {
    headers: { "x-nullspend-key": API_KEY },
  });
  const body = await response.json() as { data: { id: string; status: string }[] };

  const neverExpireResult = body.data.find((a) => a.id === neverExpire.id);
  const willExpireResult = body.data.find((a) => a.id === willExpire.id);

  assert(!!neverExpireResult, "never-expire action should be in results");
  assert(!!willExpireResult, "will-expire action should be in results");
  assertEqual(neverExpireResult!.status, "pending", "never-expire should still be pending");
  assertEqual(willExpireResult!.status, "expired", "will-expire should be expired");
}

// ---------------------------------------------------------------------------
// Exp 19: Approve races against expiration (approve before expiry)
// ---------------------------------------------------------------------------

async function testApproveBeforeExpiry() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: 30,
  });
  cleanupIds.push(created.id);

  // Approve immediately via DB
  const result = await sql`
    UPDATE actions
    SET status = 'approved', approved_at = NOW(), approved_by = 'test-user'
    WHERE id = ${created.id} AND status = 'pending'
    RETURNING status
  `;

  assertEqual(result.length, 1, "approve should succeed");
  assertEqual(result[0].status, "approved", "status should be approved");

  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.status, "approved", "getAction should return approved");
}

// ---------------------------------------------------------------------------
// Exp 20: RejectedError for expired action has correct actionStatus
// ---------------------------------------------------------------------------

async function testRejectedErrorActionStatus() {
  let thrownError: unknown;
  try {
    await sdk.proposeAndWait({
      agentId: "edge-test",
      actionType: "file_write",
      payload: { test: true },
      expiresInSeconds: 1,
      pollIntervalMs: 500,
      timeoutMs: 10_000,
      execute: async () => ({ done: true }),
    });
  } catch (err: unknown) {
    thrownError = err;
  }

  assert(thrownError !== undefined, "should have thrown");
  assert(
    thrownError instanceof Error && thrownError.constructor.name === "RejectedError",
    `expected RejectedError, got ${thrownError instanceof Error ? thrownError.constructor.name : typeof thrownError}`,
  );

  const rejErr = thrownError as { actionStatus: string };
  assertEqual(rejErr.actionStatus, "expired", "actionStatus should be 'expired'");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== Expiration Edge-Case Experiments (Wave 2) ===\n");
  console.log(`  Server: ${BASE_URL}\n`);

  try {
    await fetch(BASE_URL);
  } catch {
    console.error(`Cannot reach ${BASE_URL}. Start the dev server first.`);
    process.exit(1);
  }

  console.log("Running experiments:\n");

  await runTest("Exp 11 — expiresInSeconds: 0 = never expire", testZeroExpiresInSeconds);
  await runTest("Exp 12 — Approved action immune to expiration", testApprovedActionImmune);
  await runTest("Exp 13 — Rejected action immune to expiration", testRejectedActionImmune);
  await runTest("Exp 14 — expiredAt timestamp is set correctly", testExpiredAtTimestamp);
  await runTest("Exp 15 — Double getAction on expired action (idempotent)", testDoubleExpireIdempotent);
  await runTest("Exp 16 — Reject expired action returns 409", testRejectExpiredAction409);
  await runTest("Exp 17 — Approve expired action returns 409", testApproveExpiredAction409);
  await runTest("Exp 18 — Bulk expire selectivity (never vs will)", testBulkExpireSelectivity);
  await runTest("Exp 19 — Approve before expiry succeeds", testApproveBeforeExpiry);
  await runTest("Exp 20 — RejectedError.actionStatus is 'expired'", testRejectedErrorActionStatus);

  // Cleanup
  console.log("\nCleaning up...");
  for (const id of cleanupIds) {
    try {
      await dbDeleteAction(id);
    } catch {
      // best effort
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (failed > 0) {
    console.log("Failed experiments:");
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
