/**
 * Edge-case experiments for the Action Expiration feature.
 *
 * Tests boundary conditions, negative values, concurrent expiration,
 * list-actions bulk-expire, and interaction with markResult.
 *
 * Run: pnpm tsx scripts/expiration-edge-cases.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { AgentSeam } from "@agentseam/sdk";

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
const API_KEY = process.env.AGENTSEAM_API_KEY!;
const BASE_URL = process.env.AGENTSEAM_BASE_URL ?? "http://127.0.0.1:3000";

const sql = postgres(DATABASE_URL, { prepare: false });
const sdk = new AgentSeam({ baseUrl: BASE_URL, apiKey: API_KEY });

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
// Experiment 1: Negative expiresInSeconds should be rejected (Zod min(0))
// ---------------------------------------------------------------------------

async function testNegativeExpiresInSeconds() {
  let threw = false;
  let statusCode: number | undefined;
  try {
    await sdk.createAction({
      agentId: "edge-test",
      actionType: "file_write",
      payload: { test: true },
      expiresInSeconds: -1,
    });
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "negative expiresInSeconds should be rejected");
  assertEqual(statusCode, 400, "expected 400 for negative expiresInSeconds");
}

// ---------------------------------------------------------------------------
// Experiment 2: Float expiresInSeconds should be rejected (Zod int())
// ---------------------------------------------------------------------------

async function testFloatExpiresInSeconds() {
  let threw = false;
  let statusCode: number | undefined;
  try {
    await sdk.createAction({
      agentId: "edge-test",
      actionType: "file_write",
      payload: { test: true },
      expiresInSeconds: 1.5,
    });
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "float expiresInSeconds should be rejected");
  assertEqual(statusCode, 400, "expected 400 for float expiresInSeconds");
}

// ---------------------------------------------------------------------------
// Experiment 3: Default TTL when expiresInSeconds is omitted
// ---------------------------------------------------------------------------

async function testDefaultTtl() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
  });
  cleanupIds.push(created.id);

  assert(created.expiresAt !== null, "expiresAt should be set with default TTL");

  const expiresDate = new Date(created.expiresAt!);
  const now = new Date();
  const diffMin = (expiresDate.getTime() - now.getTime()) / 60_000;

  assert(diffMin > 55 && diffMin < 65, `default TTL should be ~60 min, got ${diffMin.toFixed(1)} min`);
}

// ---------------------------------------------------------------------------
// Experiment 4: expiresInSeconds: null means never expire
// ---------------------------------------------------------------------------

async function testNullExpiresInSeconds() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: null,
  });
  cleanupIds.push(created.id);

  assertEqual(created.expiresAt, null, "expiresAt should be null for null input");
}

// ---------------------------------------------------------------------------
// Experiment 5: expiresAt is returned in getAction response
// ---------------------------------------------------------------------------

async function testExpiresAtInGetAction() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: 600,
  });
  cleanupIds.push(created.id);

  const fetched = await sdk.getAction(created.id);
  assert(fetched.expiresAt !== null, "expiresAt should be present in getAction response");

  const diff = Math.abs(new Date(fetched.expiresAt!).getTime() - new Date(created.expiresAt!).getTime());
  assert(diff < 2000, "expiresAt from getAction should match createAction");
}

// ---------------------------------------------------------------------------
// Experiment 6: markResult on expired action should fail
// ---------------------------------------------------------------------------

async function testMarkResultOnExpired() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: 1,
  });
  cleanupIds.push(created.id);

  await sleep(3000);

  // Trigger lazy expiration
  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.status, "expired", "should be expired");

  // Now try markResult — should fail because expired is terminal
  let threw = false;
  let statusCode: number | undefined;
  try {
    await sdk.markResult(created.id, { status: "executing" });
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "markResult on expired action should throw");
  assertEqual(statusCode, 409, "expected 409 for markResult on expired action");
}

// ---------------------------------------------------------------------------
// Experiment 7: Concurrent getAction calls on expiring action (idempotency)
// ---------------------------------------------------------------------------

async function testConcurrentExpiration() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: 1,
  });
  cleanupIds.push(created.id);

  await sleep(3000);

  // Fire 5 concurrent getAction calls — all should succeed, no crashes
  const results = await Promise.all([
    sdk.getAction(created.id),
    sdk.getAction(created.id),
    sdk.getAction(created.id),
    sdk.getAction(created.id),
    sdk.getAction(created.id),
  ]);

  for (const r of results) {
    assertEqual(r.status, "expired", "all concurrent getAction should return expired");
  }
}

// ---------------------------------------------------------------------------
// Experiment 8: List actions filters correctly after expiration
// ---------------------------------------------------------------------------

async function testListActionsAfterExpiration() {
  // Create an action that expires quickly
  const created = await sdk.createAction({
    agentId: "edge-test-list",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: 1,
  });
  cleanupIds.push(created.id);

  await sleep(3000);

  // List with status=pending — should NOT include expired action
  const response = await fetch(`${BASE_URL}/api/actions?status=pending&limit=50`, {
    headers: { "x-agentseam-key": API_KEY },
  });
  const body = await response.json() as { data: { id: string; status: string }[] };
  const found = body.data.find((a: { id: string }) => a.id === created.id);
  assert(!found, "expired action should not appear in pending filter");

  // List with status=expired — should include it
  const response2 = await fetch(`${BASE_URL}/api/actions?status=expired&limit=50`, {
    headers: { "x-agentseam-key": API_KEY },
  });
  const body2 = await response2.json() as { data: { id: string; status: string }[] };
  const found2 = body2.data.find((a: { id: string }) => a.id === created.id);
  assert(!!found2, "expired action should appear in expired filter");
  assertEqual(found2!.status, "expired", "status should be expired in list");
}

// ---------------------------------------------------------------------------
// Experiment 9: proposeAndWait with short expiration
// ---------------------------------------------------------------------------

async function testProposeAndWaitExpiration() {
  let threw = false;
  let errorMessage = "";
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
    threw = true;
    if (err instanceof Error) {
      errorMessage = err.message;
    }
  }
  assert(threw, "proposeAndWait should throw when action expires");
  assert(
    errorMessage.includes("expired"),
    `error should mention expired, got: ${errorMessage}`,
  );
}

// ---------------------------------------------------------------------------
// Experiment 10: Very large expiresInSeconds
// ---------------------------------------------------------------------------

async function testVeryLargeExpires() {
  const created = await sdk.createAction({
    agentId: "edge-test",
    actionType: "file_write",
    payload: { test: true },
    expiresInSeconds: 31536000, // 1 year
  });
  cleanupIds.push(created.id);

  assert(created.expiresAt !== null, "expiresAt should be set for large TTL");

  const expiresDate = new Date(created.expiresAt!);
  const now = new Date();
  const diffDays = (expiresDate.getTime() - now.getTime()) / (86400 * 1000);
  assert(diffDays > 360 && diffDays < 370, `1-year TTL should be ~365 days, got ${diffDays.toFixed(0)} days`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== Expiration Edge-Case Experiments ===\n");
  console.log(`  Server: ${BASE_URL}\n`);

  try {
    await fetch(BASE_URL);
  } catch {
    console.error(`Cannot reach ${BASE_URL}. Start the dev server first.`);
    process.exit(1);
  }

  console.log("Running experiments:\n");

  await runTest("Exp 1  — Negative expiresInSeconds rejected", testNegativeExpiresInSeconds);
  await runTest("Exp 2  — Float expiresInSeconds rejected", testFloatExpiresInSeconds);
  await runTest("Exp 3  — Default TTL (~1 hour)", testDefaultTtl);
  await runTest("Exp 4  — expiresInSeconds: null = never expire", testNullExpiresInSeconds);
  await runTest("Exp 5  — expiresAt returned in getAction", testExpiresAtInGetAction);
  await runTest("Exp 6  — markResult on expired action (409)", testMarkResultOnExpired);
  await runTest("Exp 7  — Concurrent getAction on expiring action", testConcurrentExpiration);
  await runTest("Exp 8  — List actions filters after expiration", testListActionsAfterExpiration);
  await runTest("Exp 9  — proposeAndWait with short expiration", testProposeAndWaitExpiration);
  await runTest("Exp 10 — Very large expiresInSeconds (1 year)", testVeryLargeExpires);

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
