/**
 * End-to-end session limit smoke tests.
 *
 * Tests session-level budget aggregation against the live deployed worker.
 * Validates the full stack: Postgres → DO sync → checkAndReserve session check →
 * reconcile session correction → route denial response.
 *
 * Requires:
 *   - Live proxy at PROXY_URL
 *   - OPENAI_API_KEY, NULLSPEND_API_KEY
 *   - NULLSPEND_SMOKE_USER_ID, NULLSPEND_SMOKE_KEY_ID
 *   - INTERNAL_SECRET
 *   - DATABASE_URL
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import postgres from "postgres";
import {
  BASE,
  OPENAI_API_KEY,
  NULLSPEND_API_KEY,
  NULLSPEND_SMOKE_USER_ID,
  NULLSPEND_SMOKE_KEY_ID,
  INTERNAL_SECRET,
  authHeaders,
  smallRequest,
  isServerUp,
  invalidateBudget,
  syncBudget,
} from "./smoke-test-helpers.js";

describe("End-to-end session limit enforcement", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    const up = await isServerUp();
    if (!up) throw new Error("Proxy not reachable.");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required.");
    if (!NULLSPEND_API_KEY) throw new Error("NULLSPEND_API_KEY required.");
    if (!NULLSPEND_SMOKE_USER_ID) throw new Error("NULLSPEND_SMOKE_USER_ID required.");
    if (!NULLSPEND_SMOKE_KEY_ID) throw new Error("NULLSPEND_SMOKE_KEY_ID required.");
    if (!INTERNAL_SECRET) throw new Error("INTERNAL_SECRET required.");
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required.");

    sql = postgres(process.env.DATABASE_URL!, { max: 3, idle_timeout: 10 });
  });

  afterEach(async () => {
    // Wait for in-flight reconciliations from prior test's requests.
    // Same pattern as smoke-budget-e2e.test.ts (known flake window).
    await new Promise((r) => setTimeout(r, 5_000));

    // Remove budget from DO + delete from Postgres so next test starts clean.
    try {
      await invalidateBudget(NULLSPEND_SMOKE_USER_ID!, "user", NULLSPEND_SMOKE_USER_ID!);
    } catch { /* budget may not exist */ }
    await sql`DELETE FROM budgets WHERE entity_type = 'user' AND entity_id = ${NULLSPEND_SMOKE_USER_ID!}`;
  });

  afterAll(async () => {
    // Full cleanup: remove budget from DO + Postgres
    try {
      await invalidateBudget(NULLSPEND_SMOKE_USER_ID!, "user", NULLSPEND_SMOKE_USER_ID!);
    } catch { /* may not exist */ }
    await sql`DELETE FROM budgets WHERE entity_type = 'user' AND entity_id = ${NULLSPEND_SMOKE_USER_ID!}`;
    await sql.end();
  });

  /**
   * Insert a user budget with a session limit in Postgres and sync to DO.
   */
  async function setupBudgetWithSessionLimit(
    maxBudgetMicrodollars: number,
    sessionLimitMicrodollars: number,
  ) {
    const userId = NULLSPEND_SMOKE_USER_ID!;

    await sql`
      INSERT INTO budgets (entity_type, entity_id, max_budget_microdollars, spend_microdollars, policy, session_limit_microdollars)
      VALUES ('user', ${userId}, ${maxBudgetMicrodollars}, 0, 'strict_block', ${sessionLimitMicrodollars})
      ON CONFLICT (entity_type, entity_id)
      DO UPDATE SET max_budget_microdollars = ${maxBudgetMicrodollars},
                    spend_microdollars = 0,
                    session_limit_microdollars = ${sessionLimitMicrodollars},
                    updated_at = NOW()
    `;

    await syncBudget(userId, NULLSPEND_SMOKE_KEY_ID!);
  }

  /**
   * Insert a user budget WITHOUT a session limit.
   */
  async function setupBudgetWithoutSessionLimit(maxBudgetMicrodollars: number) {
    const userId = NULLSPEND_SMOKE_USER_ID!;

    await sql`
      INSERT INTO budgets (entity_type, entity_id, max_budget_microdollars, spend_microdollars, policy, session_limit_microdollars)
      VALUES ('user', ${userId}, ${maxBudgetMicrodollars}, 0, 'strict_block', NULL)
      ON CONFLICT (entity_type, entity_id)
      DO UPDATE SET max_budget_microdollars = ${maxBudgetMicrodollars},
                    spend_microdollars = 0,
                    session_limit_microdollars = NULL,
                    updated_at = NOW()
    `;

    await syncBudget(userId, NULLSPEND_SMOKE_KEY_ID!);
  }

  // ── Core enforcement ──────────────────────────────────────────────
  // Denial test runs FIRST to avoid inheriting a stale session_limit from prior tests.

  it("denies request with session_limit_exceeded: correct body, no Retry-After, has trace ID", async () => {
    // Session limit of 1 microdollar — any gpt-4o-mini estimate (~5 microdollars) exceeds it.
    await setupBudgetWithSessionLimit(100_000_000, 1);

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders({ "x-nullspend-session": `smoke-denied-${Date.now()}` }),
      body: smallRequest(),
    });

    expect(res.status).toBe(429);

    // Response body shape
    const body = await res.json();
    expect(body.error.code).toBe("session_limit_exceeded");
    expect(body.error.message).toContain("session");
    expect(body.error.details).toHaveProperty("session_id");
    expect(body.error.details).toHaveProperty("session_spend_microdollars");
    expect(body.error.details).toHaveProperty("session_limit_microdollars", 1);

    // No Retry-After (session is done, not retryable — unlike velocity)
    expect(res.headers.get("Retry-After")).toBeNull();
    // Trace ID present
    expect(res.headers.get("X-NullSpend-Trace-Id")).toBeTruthy();
  }, 30_000);

  it("allows request within session limit", async () => {
    await setupBudgetWithSessionLimit(100_000_000, 10_000_000); // $100 budget, $10 session limit

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders({ "x-nullspend-session": "smoke-session-ok" }),
      body: smallRequest(),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("usage");
  }, 30_000);

  // ── No enforcement without session header ─────────────────────────

  it("allows request without session header even with session limit configured", async () => {
    await setupBudgetWithSessionLimit(100_000_000, 1); // 1 microdollar session limit
    await new Promise((r) => setTimeout(r, 500)); // ensure sync propagation

    // No x-nullspend-session header → session enforcement skipped
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: smallRequest(),
    });

    expect(res.status).toBe(200);
  }, 30_000);

  // ── No enforcement without session limit ──────────────────────────

  it("allows request with session header when no session limit configured", async () => {
    await setupBudgetWithoutSessionLimit(100_000_000); // no session limit

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders({ "x-nullspend-session": "smoke-session-no-limit" }),
      body: smallRequest(),
    });

    expect(res.status).toBe(200);
  }, 30_000);

  // ── Different sessions are independent ────────────────────────────

  it("different session IDs have independent spend tracking", async () => {
    // Tiny session limit — first request's estimate exceeds it
    await setupBudgetWithSessionLimit(100_000_000, 1);

    // Session A: first request should exhaust the $0.00001 session limit
    const resA1 = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders({ "x-nullspend-session": "smoke-session-A" }),
      body: smallRequest(),
    });
    // First request may be approved (estimate fits) or denied (estimate > 10)
    // Either way, session A is now at or over the limit

    // Session B: completely fresh — should be approved or denied independently
    const resB1 = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders({ "x-nullspend-session": "smoke-session-B" }),
      body: smallRequest(),
    });

    // The key assertion: session B's outcome should be the same as session A's
    // first request (both starting from 0 spend). They should NOT influence each other.
    expect(resB1.status).toBe(resA1.status);
  }, 30_000);

  // ── Stress: rapid requests accumulate session spend ────────────────

  it("multiple requests approved under generous session limit", async () => {
    // Verify that a generous session limit allows multiple requests through.
    // This proves session enforcement doesn't false-deny under normal usage.
    await setupBudgetWithSessionLimit(100_000_000, 10_000_000); // $10 session limit

    const sessionId = `smoke-generous-${Date.now()}`;

    // Send 3 requests — all should be approved
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: authHeaders({ "x-nullspend-session": sessionId }),
        body: smallRequest(),
      });
      expect(res.status).toBe(200);
      await res.json();
    }
  }, 60_000);
});
