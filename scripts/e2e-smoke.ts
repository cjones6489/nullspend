/**
 * End-to-end smoke test for the NullSpend approval lifecycle.
 *
 * Requires:
 *   - Dev server running at http://127.0.0.1:3000
 *   - DATABASE_URL, NULLSPEND_API_KEY, NULLSPEND_DEV_ACTOR in .env.local
 *
 * Run: pnpm e2e
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { NullSpend } from "@nullspend/sdk";

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

const DATABASE_URL = process.env.DATABASE_URL;
const API_KEY = process.env.NULLSPEND_API_KEY;
const DEV_ACTOR = process.env.NULLSPEND_DEV_ACTOR;
const BASE_URL = process.env.NULLSPEND_BASE_URL ?? "http://127.0.0.1:3000";

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (!API_KEY) {
  console.error("NULLSPEND_API_KEY is not set.");
  process.exit(1);
}
if (!DEV_ACTOR) {
  console.error("NULLSPEND_DEV_ACTOR is not set.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const sql = postgres(DATABASE_URL, { prepare: false });
const sdk = new NullSpend({ baseUrl: BASE_URL, apiKey: API_KEY });

// ---------------------------------------------------------------------------
// Direct DB helpers (bypass session auth)
// ---------------------------------------------------------------------------

async function dbApproveAction(actionId: string, ownerUserId: string) {
  const rows = await sql`
    UPDATE actions
    SET status = 'approved',
        approved_at = NOW(),
        approved_by = ${ownerUserId}
    WHERE id = ${actionId}
      AND owner_user_id = ${ownerUserId}
      AND status = 'pending'
    RETURNING id, status
  `;
  if (rows.length === 0) {
    throw new Error(`Failed to approve action ${actionId} — not found or not pending`);
  }
  return rows[0];
}

async function dbRejectAction(actionId: string, ownerUserId: string) {
  const rows = await sql`
    UPDATE actions
    SET status = 'rejected',
        rejected_at = NOW(),
        rejected_by = ${ownerUserId}
    WHERE id = ${actionId}
      AND owner_user_id = ${ownerUserId}
      AND status = 'pending'
    RETURNING id, status
  `;
  if (rows.length === 0) {
    throw new Error(`Failed to reject action ${actionId} — not found or not pending`);
  }
  return rows[0];
}

async function dbDeleteAction(actionId: string) {
  await sql`DELETE FROM actions WHERE id = ${actionId}`;
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];
const cleanupIds: string[] = [];

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

// ---------------------------------------------------------------------------
// Test 1 — Happy path lifecycle
// ---------------------------------------------------------------------------

async function testHappyPath() {
  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "file_write",
    payload: { path: "/tmp/test.txt", content: "hello" },
    metadata: { test: "happy-path" },
  });
  cleanupIds.push(created.id);

  assertEqual(created.status, "pending", "created.status");
  assert(!!created.id, "created.id should be a non-empty string");

  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.status, "pending", "fetched.status after create");
  assertEqual(fetched.agentId, "e2e-test-agent", "fetched.agentId");

  await dbApproveAction(created.id, DEV_ACTOR!);

  const afterApprove = await sdk.getAction(created.id);
  assertEqual(afterApprove.status, "approved", "status after approve");
  assert(afterApprove.approvedAt !== null, "approvedAt should be set");

  await sdk.markResult(created.id, { status: "executing" });

  const afterExecuting = await sdk.getAction(created.id);
  assertEqual(afterExecuting.status, "executing", "status after markResult(executing)");

  await sdk.markResult(created.id, {
    status: "executed",
    result: { output: "file written" },
  });

  const final = await sdk.getAction(created.id);
  assertEqual(final.status, "executed", "final status");
  assert(final.executedAt !== null, "executedAt should be set");
  assertEqual(
    (final.result as Record<string, unknown>)?.output,
    "file written",
    "result.output",
  );
}

// ---------------------------------------------------------------------------
// Test 2 — Rejection path
// ---------------------------------------------------------------------------

async function testRejectionPath() {
  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "http_delete",
    payload: { url: "https://example.com/database", confirm: false },
    metadata: { test: "rejection" },
  });
  cleanupIds.push(created.id);

  assertEqual(created.status, "pending", "created.status");

  await dbRejectAction(created.id, DEV_ACTOR!);

  const afterReject = await sdk.getAction(created.id);
  assertEqual(afterReject.status, "rejected", "status after reject");
  assert(afterReject.rejectedAt !== null, "rejectedAt should be set");

  // Verify no further transitions are possible from rejected
  let threw = false;
  try {
    await sdk.markResult(created.id, { status: "executing" });
  } catch {
    threw = true;
  }
  assert(threw, "markResult on rejected action should throw");
}

// ---------------------------------------------------------------------------
// Test 3 — proposeAndWait orchestration
// ---------------------------------------------------------------------------

async function testProposeAndWait() {
  let executeCalled = false;

  const resultPromise = sdk.proposeAndWait<{ answer: number }>({
    agentId: "e2e-test-agent",
    actionType: "http_post",
    payload: { url: "https://example.com/calculate", expression: "2+2" },
    metadata: { test: "propose-and-wait" },
    pollIntervalMs: 500,
    timeoutMs: 30_000,
    execute: async () => {
      executeCalled = true;
      return { answer: 4 };
    },
  });

  // Poll for the pending action and approve it in parallel
  let approved = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    // Find the pending action by listing recent actions
    const pending = await sql`
      SELECT id FROM actions
      WHERE agent_id = 'e2e-test-agent'
        AND status = 'pending'
        AND metadata_json->>'test' = 'propose-and-wait'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (pending.length > 0) {
      cleanupIds.push(pending[0].id);
      await dbApproveAction(pending[0].id, DEV_ACTOR!);
      approved = true;
      break;
    }
  }

  assert(approved, "should have found and approved the pending action");

  const result = await resultPromise;
  assertEqual(result.answer, 4, "proposeAndWait result.answer");
  assert(executeCalled, "execute callback should have been called");
}

// ---------------------------------------------------------------------------
// Test 4 — Execution failure
// ---------------------------------------------------------------------------

async function testExecutionFailure() {
  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "shell_command",
    payload: { command: "deploy --target production" },
    metadata: { test: "execution-failure" },
  });
  cleanupIds.push(created.id);

  await dbApproveAction(created.id, DEV_ACTOR!);

  await sdk.markResult(created.id, { status: "executing" });

  await sdk.markResult(created.id, {
    status: "failed",
    errorMessage: "Connection refused to deployment server",
  });

  const final = await sdk.getAction(created.id);
  assertEqual(final.status, "failed", "final status should be failed");
  assertEqual(
    final.errorMessage,
    "Connection refused to deployment server",
    "errorMessage",
  );
}

// ---------------------------------------------------------------------------
// Test 5 — Invalid API key
// ---------------------------------------------------------------------------

async function testInvalidApiKey() {
  const badSdk = new NullSpend({ baseUrl: BASE_URL, apiKey: "ask_bogus_key_12345" });

  let threw = false;
  let statusCode: number | undefined;
  try {
    await badSdk.createAction({
      agentId: "e2e-test-agent",
      actionType: "file_write",
      payload: { path: "/tmp/nope.txt" },
    });
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "should throw with invalid API key");
  assert(statusCode === 403 || statusCode === 401, `expected 401 or 403, got ${statusCode}`);
}

// ---------------------------------------------------------------------------
// Test 6 — Double approve (optimistic locking)
// ---------------------------------------------------------------------------

async function testDoubleApprove() {
  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "file_write",
    payload: { path: "/tmp/double.txt" },
    metadata: { test: "double-approve" },
  });
  cleanupIds.push(created.id);

  await dbApproveAction(created.id, DEV_ACTOR!);

  // Second approve should fail — action is no longer pending
  let threw = false;
  try {
    await dbApproveAction(created.id, DEV_ACTOR!);
  } catch {
    threw = true;
  }
  assert(threw, "double approve should throw (not pending anymore)");

  const final = await sdk.getAction(created.id);
  assertEqual(final.status, "approved", "status should still be approved");
}

// ---------------------------------------------------------------------------
// Test 7 — Invalid state transition
// ---------------------------------------------------------------------------

async function testInvalidTransition() {
  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "db_write",
    payload: { query: "INSERT INTO test" },
    metadata: { test: "invalid-transition" },
  });
  cleanupIds.push(created.id);

  // Try to markResult(executing) on a pending action (must be approved first)
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
  assert(threw, "markResult on pending action should throw");
  assertEqual(statusCode, 409, "expected 409 for invalid transition");

  const final = await sdk.getAction(created.id);
  assertEqual(final.status, "pending", "status should remain pending");
}

// ---------------------------------------------------------------------------
// Test 8 — Get non-existent action
// ---------------------------------------------------------------------------

async function testNotFound() {
  let threw = false;
  let statusCode: number | undefined;
  try {
    await sdk.getAction("00000000-0000-0000-0000-000000000000");
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "getting non-existent action should throw");
  assertEqual(statusCode, 404, "expected 404 for non-existent action");
}

// ---------------------------------------------------------------------------
// Test 9 — Invalid input (bad action type)
// ---------------------------------------------------------------------------

async function testInvalidInput() {
  let threw = false;
  let statusCode: number | undefined;
  try {
    await sdk.createAction({
      agentId: "e2e-test-agent",
      actionType: "nonexistent_type" as never,
      payload: { foo: "bar" },
    });
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "creating action with invalid type should throw");
  assertEqual(statusCode, 400, "expected 400 for validation failure");
}

// ---------------------------------------------------------------------------
// Test 10 — Large payload
// ---------------------------------------------------------------------------

async function testLargePayload() {
  // 400 items × ~150 bytes each ≈ 61KB — just under the 64KB payload limit.
  // (Previously used 500 items which exceeded 64KB and was rejected by validation.)
  const largeArray = Array.from({ length: 400 }, (_, i) => ({
    index: i,
    data: "x".repeat(100),
    nested: { key: `value-${i}` },
  }));

  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "db_write",
    payload: { records: largeArray },
    metadata: { test: "large-payload", size: largeArray.length },
  });
  cleanupIds.push(created.id);

  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.status, "pending", "large payload action should be pending");
  const records = (fetched.payload as { records: unknown[] }).records;
  assertEqual(records.length, 400, "payload should preserve all 400 records");
}

// ---------------------------------------------------------------------------
// Test 11 — Unicode and special characters
// ---------------------------------------------------------------------------

async function testUnicodeAndSpecialChars() {
  const created = await sdk.createAction({
    agentId: "agent-日本語-émojis-🚀",
    actionType: "send_email",
    payload: {
      to: "user@例え.jp",
      subject: "Ñoño señor — «quotes» & \u201Csmart quotes\u201D",
      body: "Line1\nLine2\tTabbed\r\nWindows line",
    },
    metadata: {
      test: "unicode",
      tags: ["café", "naïve", "中文", "🎉🎊"],
      nullish: null,
    },
  });
  cleanupIds.push(created.id);

  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.agentId, "agent-日本語-émojis-🚀", "agentId should preserve unicode");
  assertEqual(
    (fetched.payload as Record<string, unknown>).to,
    "user@例え.jp",
    "payload should preserve unicode",
  );
  const meta = fetched.metadata as Record<string, unknown>;
  assertEqual((meta.tags as string[])[2], "中文", "metadata should preserve CJK");
}

// ---------------------------------------------------------------------------
// Test 12 — Empty agentId rejected
// ---------------------------------------------------------------------------

async function testEmptyAgentId() {
  let threw = false;
  let statusCode: number | undefined;
  try {
    await sdk.createAction({
      agentId: "",
      actionType: "file_write",
      payload: { path: "/tmp/empty.txt" },
    });
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "empty agentId should be rejected");
  assertEqual(statusCode, 400, "expected 400 for empty agentId");
}

// ---------------------------------------------------------------------------
// Test 13 — Minimal valid input (no metadata)
// ---------------------------------------------------------------------------

async function testMinimalInput() {
  const created = await sdk.createAction({
    agentId: "a",
    actionType: "send_email",
    payload: {},
  });
  cleanupIds.push(created.id);

  assertEqual(created.status, "pending", "minimal action should be pending");

  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.agentId, "a", "single-char agentId should work");
  assert(
    fetched.metadata === null || fetched.metadata === undefined,
    "metadata should be null/undefined when not provided",
  );
}

// ---------------------------------------------------------------------------
// Test 14 — Skip executing (approved → executed directly)
// ---------------------------------------------------------------------------

async function testSkipExecuting() {
  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "file_write",
    payload: { path: "/tmp/skip.txt" },
    metadata: { test: "skip-executing" },
  });
  cleanupIds.push(created.id);

  await dbApproveAction(created.id, DEV_ACTOR!);

  // Try to go directly to "executed" without "executing" first
  let threw = false;
  let statusCode: number | undefined;
  try {
    await sdk.markResult(created.id, {
      status: "executed",
      result: { done: true },
    });
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "approved → executed directly should be rejected");
  assertEqual(statusCode, 409, "expected 409 for skipping executing state");
}

// ---------------------------------------------------------------------------
// Test 15 — Transition from terminal state
// ---------------------------------------------------------------------------

async function testTerminalStateImmutable() {
  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "file_delete",
    payload: { path: "/tmp/terminal.txt" },
    metadata: { test: "terminal-immutable" },
  });
  cleanupIds.push(created.id);

  await dbApproveAction(created.id, DEV_ACTOR!);
  await sdk.markResult(created.id, { status: "executing" });
  await sdk.markResult(created.id, {
    status: "executed",
    result: { deleted: true },
  });

  // Try to transition from executed back to executing
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
  assert(threw, "transition from executed should be rejected");
  assertEqual(statusCode, 409, "expected 409 for terminal state transition");
}

// ---------------------------------------------------------------------------
// Test 16 — markResult(failed) without errorMessage
// ---------------------------------------------------------------------------

async function testFailedWithoutErrorMessage() {
  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "http_post",
    payload: { url: "https://example.com/fail" },
    metadata: { test: "failed-no-error" },
  });
  cleanupIds.push(created.id);

  await dbApproveAction(created.id, DEV_ACTOR!);
  await sdk.markResult(created.id, { status: "executing" });

  let threw = false;
  let statusCode: number | undefined;
  try {
    await sdk.markResult(created.id, { status: "failed" });
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "markResult(failed) without errorMessage should be rejected");
  assertEqual(statusCode, 400, "expected 400 for missing errorMessage");
}

// ---------------------------------------------------------------------------
// Test 17 — Concurrent approve and reject (race condition)
// ---------------------------------------------------------------------------

async function testConcurrentApproveReject() {
  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "file_write",
    payload: { path: "/tmp/race.txt" },
    metadata: { test: "concurrent-race" },
  });
  cleanupIds.push(created.id);

  // Fire approve and reject simultaneously
  const results = await Promise.allSettled([
    dbApproveAction(created.id, DEV_ACTOR!),
    dbRejectAction(created.id, DEV_ACTOR!),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected").length;

  assertEqual(fulfilled, 1, "exactly one operation should succeed");
  assertEqual(rejected, 1, "exactly one operation should fail");

  const final = await sdk.getAction(created.id);
  assert(
    final.status === "approved" || final.status === "rejected",
    `final status should be approved or rejected, got ${final.status}`,
  );
}

// ---------------------------------------------------------------------------
// Test 18 — proposeAndWait with rejection throws RejectedError
// ---------------------------------------------------------------------------

async function testProposeAndWaitRejection() {
  const execute = vi_fn();

  const resultPromise = sdk.proposeAndWait({
    agentId: "e2e-test-agent",
    actionType: "http_delete",
    payload: { url: "https://example.com/dangerous" },
    metadata: { test: "propose-wait-reject" },
    pollIntervalMs: 500,
    timeoutMs: 30_000,
    execute: async () => {
      execute();
      return { done: true };
    },
  });

  // Poll and reject the pending action
  let rejected = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const pending = await sql`
      SELECT id FROM actions
      WHERE agent_id = 'e2e-test-agent'
        AND status = 'pending'
        AND metadata_json->>'test' = 'propose-wait-reject'
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (pending.length > 0) {
      cleanupIds.push(pending[0].id);
      await dbRejectAction(pending[0].id, DEV_ACTOR!);
      rejected = true;
      break;
    }
  }

  assert(rejected, "should have found and rejected the pending action");

  let threw = false;
  let errorName = "";
  try {
    await resultPromise;
  } catch (err: unknown) {
    threw = true;
    if (err instanceof Error) {
      errorName = err.name;
    }
  }
  assert(threw, "proposeAndWait should throw on rejection");
  assertEqual(errorName, "RejectedError", "should throw RejectedError");
  assert(!execute.called, "execute should NOT have been called");
}

// Simple call tracker (no vitest dependency)
function vi_fn() {
  const fn = () => { fn.called = true; fn.callCount++; };
  fn.called = false;
  fn.callCount = 0;
  return fn;
}

// ---------------------------------------------------------------------------
// Test 19 — proposeAndWait timeout
// ---------------------------------------------------------------------------

async function testProposeAndWaitTimeout() {
  let threw = false;
  let errorName = "";
  let actionId: string | undefined;

  try {
    await sdk.proposeAndWait({
      agentId: "e2e-test-agent",
      actionType: "shell_command",
      payload: { command: "echo timeout-test" },
      metadata: { test: "propose-wait-timeout" },
      pollIntervalMs: 200,
      timeoutMs: 1_500,
      execute: async () => ({ done: true }),
    });
  } catch (err: unknown) {
    threw = true;
    if (err instanceof Error) {
      errorName = err.name;
    }
  }

  // Cleanup: find and delete the orphaned action
  const orphaned = await sql`
    SELECT id FROM actions
    WHERE agent_id = 'e2e-test-agent'
      AND metadata_json->>'test' = 'propose-wait-timeout'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (orphaned.length > 0) {
    cleanupIds.push(orphaned[0].id);
  }

  assert(threw, "proposeAndWait should throw on timeout");
  assertEqual(errorName, "TimeoutError", "should throw TimeoutError");
}

// ---------------------------------------------------------------------------
// Test 20 — Response shape completeness
// ---------------------------------------------------------------------------

async function testResponseShape() {
  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "send_email",
    payload: { to: "test@example.com" },
    metadata: { test: "response-shape" },
  });
  cleanupIds.push(created.id);

  const action = await sdk.getAction(created.id);

  // Verify all expected fields exist with correct types
  assert(typeof action.id === "string", "id should be string");
  assert(typeof action.agentId === "string", "agentId should be string");
  assert(typeof action.actionType === "string", "actionType should be string");
  assert(typeof action.status === "string", "status should be string");
  assert(typeof action.payload === "object" && action.payload !== null, "payload should be object");
  assert(typeof action.createdAt === "string", "createdAt should be ISO string");

  // Verify null fields
  assert(action.approvedAt === null, "approvedAt should be null for pending");
  assert(action.rejectedAt === null, "rejectedAt should be null for pending");
  assert(action.executedAt === null, "executedAt should be null for pending");
  assert(typeof action.expiresAt === "string", "expiresAt should be set (default TTL)");
  assert(action.expiredAt === null, "expiredAt should be null for pending");
  assert(action.approvedBy === null, "approvedBy should be null for pending");
  assert(action.rejectedBy === null, "rejectedBy should be null for pending");
  assert(action.result === null, "result should be null for pending");
  assert(action.errorMessage === null, "errorMessage should be null for pending");

  // Verify createdAt is a valid ISO date
  const date = new Date(action.createdAt);
  assert(!isNaN(date.getTime()), "createdAt should be a valid date");
  const age = Math.abs(Date.now() - date.getTime());
  assert(age < 120_000, "createdAt should be recent (within 2 min, accounting for clock skew)");
}

// ---------------------------------------------------------------------------
// Test 21 — Multiple actions don't interfere
// ---------------------------------------------------------------------------

async function testActionIsolation() {
  const [a1, a2, a3] = await Promise.all([
    sdk.createAction({
      agentId: "agent-isolation-1",
      actionType: "file_write",
      payload: { file: "a" },
      metadata: { test: "isolation" },
    }),
    sdk.createAction({
      agentId: "agent-isolation-2",
      actionType: "http_post",
      payload: { file: "b" },
      metadata: { test: "isolation" },
    }),
    sdk.createAction({
      agentId: "agent-isolation-3",
      actionType: "db_write",
      payload: { file: "c" },
      metadata: { test: "isolation" },
    }),
  ]);
  cleanupIds.push(a1.id, a2.id, a3.id);

  // Approve only the second one
  await dbApproveAction(a2.id, DEV_ACTOR!);

  // Reject the third one
  await dbRejectAction(a3.id, DEV_ACTOR!);

  // Verify each is in its expected state
  const [f1, f2, f3] = await Promise.all([
    sdk.getAction(a1.id),
    sdk.getAction(a2.id),
    sdk.getAction(a3.id),
  ]);

  assertEqual(f1.status, "pending", "action 1 should remain pending");
  assertEqual(f1.agentId, "agent-isolation-1", "action 1 agentId preserved");
  assertEqual(f2.status, "approved", "action 2 should be approved");
  assertEqual(f2.agentId, "agent-isolation-2", "action 2 agentId preserved");
  assertEqual(f3.status, "rejected", "action 3 should be rejected");
  assertEqual(f3.agentId, "agent-isolation-3", "action 3 agentId preserved");

  // Verify mutations on one don't affect others
  await sdk.markResult(a2.id, { status: "executing" });
  const f1After = await sdk.getAction(a1.id);
  assertEqual(f1After.status, "pending", "action 1 unaffected by action 2 mutation");
}

// ---------------------------------------------------------------------------
// Test 22 — Whitespace-only agentId rejected
// ---------------------------------------------------------------------------

async function testWhitespaceAgentId() {
  let threw = false;
  let statusCode: number | undefined;
  try {
    await sdk.createAction({
      agentId: "   ",
      actionType: "file_write",
      payload: { path: "/tmp/ws.txt" },
    });
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "whitespace-only agentId should be rejected");
  assertEqual(statusCode, 400, "expected 400 for whitespace agentId");
}

// ---------------------------------------------------------------------------
// Test 23 — Non-UUID action ID returns 400, not 500
// ---------------------------------------------------------------------------

async function testNonUuidActionId() {
  let threw = false;
  let statusCode: number | undefined;
  try {
    await sdk.getAction("not-a-uuid");
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "non-UUID action ID should throw");
  assert(
    statusCode === 400 || statusCode === 404,
    `expected 400 or 404 for non-UUID, got ${statusCode}`,
  );
}

// ---------------------------------------------------------------------------
// Test 24 — markResult with result on executing is rejected
// ---------------------------------------------------------------------------

async function testExecutingWithResult() {
  let threw = false;
  let statusCode: number | undefined;

  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "file_write",
    payload: { path: "/tmp/exec-result.txt" },
    metadata: { test: "executing-with-result" },
  });
  cleanupIds.push(created.id);

  await dbApproveAction(created.id, DEV_ACTOR!);

  try {
    await sdk.markResult(created.id, {
      status: "executing",
      result: { should: "not be allowed" },
    } as never);
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "executing with result should be rejected");
  assertEqual(statusCode, 400, "expected 400 for result on executing");
}

// ---------------------------------------------------------------------------
// Test 25 — Action expiration via getAction
// ---------------------------------------------------------------------------

async function testExpirationViaGetAction() {
  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "file_write",
    payload: { path: "/tmp/expire-test.txt" },
    metadata: { test: "expiration" },
    expiresInSeconds: 1,
  });
  cleanupIds.push(created.id);

  assertEqual(created.status, "pending", "created.status");
  assert(created.expiresAt !== null, "expiresAt should be set");

  await sleep(3000);

  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.status, "expired", "status should be expired after TTL");
  assert(fetched.expiredAt !== null, "expiredAt should be set");
}

// ---------------------------------------------------------------------------
// Test 26 — Never-expire action (expiresInSeconds: 0)
// ---------------------------------------------------------------------------

async function testNeverExpire() {
  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "file_write",
    payload: { path: "/tmp/never-expire.txt" },
    metadata: { test: "never-expire" },
    expiresInSeconds: 0,
  });
  cleanupIds.push(created.id);

  assertEqual(created.status, "pending", "created.status");
  assert(created.expiresAt === null, "expiresAt should be null for never-expire");

  await sleep(3000);

  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.status, "pending", "status should still be pending");
}

// ---------------------------------------------------------------------------
// Test 27 — Approve after expiration fails
// ---------------------------------------------------------------------------

async function testApproveAfterExpiration() {
  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "file_write",
    payload: { path: "/tmp/approve-expired.txt" },
    metadata: { test: "approve-expired" },
    expiresInSeconds: 1,
  });
  cleanupIds.push(created.id);

  await sleep(3000);

  // Trigger lazy expiration via getAction
  const fetched = await sdk.getAction(created.id);
  assertEqual(fetched.status, "expired", "status should be expired");

  // Now try to approve via direct DB — should fail because status is no longer pending
  let threw = false;
  try {
    await dbApproveAction(created.id, DEV_ACTOR!);
  } catch {
    threw = true;
  }
  assert(threw, "dbApproveAction should fail on expired action");
}

// ---------------------------------------------------------------------------
// Test 28 — expiresInSeconds above 30 days rejected (3.2)
// ---------------------------------------------------------------------------

async function testExpiresInSecondsBound() {
  let threw = false;
  let statusCode: number | undefined;
  try {
    await sdk.createAction({
      agentId: "e2e-test-agent",
      actionType: "file_write",
      payload: { path: "/tmp/ttl-test.txt" },
      expiresInSeconds: 2_592_001, // 30 days + 1 second
    });
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "expiresInSeconds > 30 days should be rejected");
  assertEqual(statusCode, 400, "expected 400 for expiresInSeconds too large");
}

// ---------------------------------------------------------------------------
// Test 29 — Content-Type: text/plain rejected with 415 (3.3)
// ---------------------------------------------------------------------------

async function testContentTypeValidation() {
  const res = await fetch(`${BASE_URL}/api/actions`, {
    method: "POST",
    headers: {
      "x-nullspend-key": API_KEY!,
      "content-type": "text/plain",
    },
    body: JSON.stringify({
      agentId: "e2e-test-agent",
      actionType: "file_write",
      payload: { path: "/tmp/ct-test.txt" },
    }),
  });
  assertEqual(res.status, 415, "text/plain Content-Type should return 415");
  const body = await res.json();
  assert(
    body.error.includes("application/json"),
    `error should mention application/json, got: ${body.error}`,
  );
}

// ---------------------------------------------------------------------------
// Test 30 — Deeply nested payload rejected with 400 (3.1)
// ---------------------------------------------------------------------------

async function testDeepNestingRejected() {
  // Build a 21-level nested object
  let nested: Record<string, unknown> = { value: "leaf" };
  for (let i = 0; i < 20; i++) {
    nested = { nested };
  }

  let threw = false;
  let statusCode: number | undefined;
  try {
    await sdk.createAction({
      agentId: "e2e-test-agent",
      actionType: "file_write",
      payload: nested,
    });
  } catch (err: unknown) {
    threw = true;
    if (err && typeof err === "object" && "statusCode" in err) {
      statusCode = (err as { statusCode: number }).statusCode;
    }
  }
  assert(threw, "21-level nested payload should be rejected");
  assertEqual(statusCode, 400, "expected 400 for deeply nested payload");
}

// ---------------------------------------------------------------------------
// Test 31 — Payload at exactly 20 levels accepted (3.1)
// ---------------------------------------------------------------------------

async function testMaxDepthAccepted() {
  // Build exactly 20-level nested object
  let nested: Record<string, unknown> = { value: "leaf" };
  for (let i = 1; i < 20; i++) {
    nested = { nested };
  }

  const created = await sdk.createAction({
    agentId: "e2e-test-agent",
    actionType: "file_write",
    payload: nested,
    metadata: { test: "depth-limit-ok" },
  });
  cleanupIds.push(created.id);

  assertEqual(created.status, "pending", "20-level payload should be accepted");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n=== NullSpend E2E Smoke Test ===\n");
  console.log(`  Server:  ${BASE_URL}`);
  console.log(`  Actor:   ${DEV_ACTOR}`);
  console.log("");

  // Verify the server is reachable
  try {
    const res = await fetch(`${BASE_URL}/api/actions?limit=1`, {
      headers: { "x-nullspend-key": API_KEY! },
    });
    if (!res.ok) {
      console.error(`Server returned ${res.status}. Is the dev server running?`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Cannot reach ${BASE_URL}. Start the dev server first: pnpm dev`);
    process.exit(1);
  }

  console.log("Running tests:\n");

  // Core lifecycle
  await runTest("Test 1  — Happy path lifecycle", testHappyPath);
  await runTest("Test 2  — Rejection path", testRejectionPath);
  await runTest("Test 3  — proposeAndWait orchestration", testProposeAndWait);
  await runTest("Test 4  — Execution failure", testExecutionFailure);

  // Auth & validation
  await runTest("Test 5  — Invalid API key", testInvalidApiKey);
  await runTest("Test 6  — Double approve (optimistic locking)", testDoubleApprove);
  await runTest("Test 7  — Invalid state transition", testInvalidTransition);
  await runTest("Test 8  — Get non-existent action", testNotFound);
  await runTest("Test 9  — Invalid input (bad action type)", testInvalidInput);

  // Boundary values
  await runTest("Test 10 — Large payload (~61KB)", testLargePayload);
  await runTest("Test 11 — Unicode and special characters", testUnicodeAndSpecialChars);
  await runTest("Test 12 — Empty agentId rejected", testEmptyAgentId);
  await runTest("Test 13 — Minimal valid input (no metadata)", testMinimalInput);

  // State machine completeness
  await runTest("Test 14 — Skip executing (approved → executed)", testSkipExecuting);
  await runTest("Test 15 — Terminal state immutable", testTerminalStateImmutable);
  await runTest("Test 16 — Failed without errorMessage", testFailedWithoutErrorMessage);

  // Concurrency
  await runTest("Test 17 — Concurrent approve and reject", testConcurrentApproveReject);

  // SDK high-level edge cases
  await runTest("Test 18 — proposeAndWait rejection", testProposeAndWaitRejection);
  await runTest("Test 19 — proposeAndWait timeout", testProposeAndWaitTimeout);

  // Data integrity
  await runTest("Test 20 — Response shape completeness", testResponseShape);
  await runTest("Test 21 — Multiple actions don't interfere", testActionIsolation);

  // Input edge cases
  await runTest("Test 22 — Whitespace-only agentId rejected", testWhitespaceAgentId);
  await runTest("Test 23 — Non-UUID action ID", testNonUuidActionId);
  await runTest("Test 24 — Executing with result rejected", testExecutingWithResult);

  // Expiration
  await runTest("Test 25 — Action expiration via getAction", testExpirationViaGetAction);
  await runTest("Test 26 — Never-expire action (expiresInSeconds: 0)", testNeverExpire);
  await runTest("Test 27 — Approve after expiration fails", testApproveAfterExpiration);

  // Phase 3: Input validation hardening
  await runTest("Test 28 — expiresInSeconds > 30 days rejected", testExpiresInSecondsBound);
  await runTest("Test 29 — Content-Type: text/plain → 415", testContentTypeValidation);
  await runTest("Test 30 — 21-level nested payload → 400", testDeepNestingRejected);
  await runTest("Test 31 — 20-level nested payload accepted", testMaxDepthAccepted);

  // Cleanup
  console.log("\nCleaning up test data...");
  for (const id of cleanupIds) {
    try {
      await dbDeleteAction(id);
    } catch {
      // Best effort
    }
  }

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

main().catch((err) => {
  console.error("\nFatal error:", err);
  sql.end().finally(() => process.exit(1));
});
