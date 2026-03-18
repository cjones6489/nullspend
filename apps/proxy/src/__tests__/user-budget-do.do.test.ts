import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vitest";

function getStub(userId: string) {
  return env.USER_BUDGET.get(env.USER_BUDGET.idFromName(userId));
}

describe("UserBudgetDO", () => {
  // ── populateIfEmpty ──────────────────────────────────────────────

  it("populates a new budget and returns true", async () => {
    const stub = getStub("user-populate-1");
    const inserted = await stub.populateIfEmpty(
      "user", "u1", 50_000_000, 0, "strict_block", null, 0,
    );
    expect(inserted).toBe(true);

    const state = await stub.getBudgetState();
    expect(state).toHaveLength(1);
    expect(state[0].max_budget).toBe(50_000_000);
    expect(state[0].spend).toBe(0);
    expect(state[0].reserved).toBe(0);
  });

  it("returns false on second call and UPSERTs config fields", async () => {
    const stub = getStub("user-populate-2");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);
    const second = await stub.populateIfEmpty("user", "u1", 99_000_000, 99, "warn", null, 0);
    expect(second).toBe(false);

    const state = await stub.getBudgetState();
    expect(state).toHaveLength(1);
    // Config fields updated by UPSERT
    expect(state[0].max_budget).toBe(99_000_000);
    expect(state[0].policy).toBe("warn");
  });

  it("UPSERT preserves DO's spend (not overwritten by Postgres value)", async () => {
    const stub = getStub("user-populate-spend");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 10_000_000, "strict_block", null, 0);

    // Simulate DO accumulating spend via reconcile
    const check = await stub.checkAndReserve([{ type: "user", id: "u1" }], 5_000_000);
    await stub.reconcile(check.reservationId!, 5_000_000);

    // Re-populate with different spend from Postgres (stale)
    await stub.populateIfEmpty("user", "u1", 50_000_000, 10_000_000, "strict_block", null, 0);

    const state = await stub.getBudgetState();
    expect(state[0].spend).toBe(15_000_000); // DO's authoritative 10M + 5M, not Postgres's 10M
  });

  it("UPSERT preserves DO's reserved (not overwritten)", async () => {
    const stub = getStub("user-populate-reserved");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    // Create a reservation
    const check = await stub.checkAndReserve([{ type: "user", id: "u1" }], 10_000_000);
    expect(check.status).toBe("approved");

    // Re-populate — reserved should survive
    await stub.populateIfEmpty("user", "u1", 60_000_000, 0, "strict_block", null, 0);

    const state = await stub.getBudgetState();
    expect(state[0].reserved).toBe(10_000_000); // Preserved
    expect(state[0].max_budget).toBe(60_000_000); // Config updated
  });

  it("UPSERT preserves DO's period_start (not overwritten)", async () => {
    const stub = getStub("user-populate-period");
    const twoDaysAgo = Date.now() - 2 * 86_400_000;
    await stub.populateIfEmpty("user", "u1", 50_000_000, 50_000_000, "strict_block", "daily", twoDaysAgo);

    // Trigger inline period reset
    await stub.checkAndReserve([{ type: "user", id: "u1" }], 1_000);

    const stateAfterReset = await stub.getBudgetState();
    const dosPeriodStart = stateAfterReset[0].period_start;
    expect(dosPeriodStart).toBeGreaterThan(twoDaysAgo);

    // Re-populate with stale period_start from Postgres
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", "daily", twoDaysAgo);

    const stateAfterUpsert = await stub.getBudgetState();
    expect(stateAfterUpsert[0].period_start).toBe(dosPeriodStart); // Preserved
  });

  it("UPSERT updates reset_interval from Postgres", async () => {
    const stub = getStub("user-populate-interval");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", "daily", Date.now());

    // Change interval
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", "monthly", Date.now());

    const state = await stub.getBudgetState();
    expect(state[0].reset_interval).toBe("monthly");
  });

  // ── checkAndReserve ──────────────────────────────────────────────

  it("approves when estimate is within budget", async () => {
    const stub = getStub("user-approve-1");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 10_000_000, "strict_block", null, 0);

    const result = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }], 20_000_000,
    );
    expect(result.status).toBe("approved");
    expect(result.reservationId).toBeDefined();
    expect(typeof result.reservationId).toBe("string");
  });

  it("denies when estimate exceeds remaining budget", async () => {
    const stub = getStub("user-deny-1");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 40_000_000, "strict_block", null, 0);

    const result = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }], 20_000_000,
    );
    expect(result.status).toBe("denied");
    expect(result.deniedEntity).toBe("user:u1");
    expect(result.remaining).toBe(10_000_000);
    expect(result.maxBudget).toBe(50_000_000);
    expect(result.spend).toBe(40_000_000);
  });

  it("denies atomically when most restrictive entity fails (multi-entity)", async () => {
    const stub = getStub("user-multi-1");
    // User budget: plenty of room
    await stub.populateIfEmpty("user", "u1", 100_000_000, 0, "strict_block", null, 0);
    // API key budget: nearly full
    await stub.populateIfEmpty("api_key", "k1", 10_000_000, 8_000_000, "strict_block", null, 0);

    const result = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }, { type: "api_key", id: "k1" }],
      5_000_000,
    );
    expect(result.status).toBe("denied");
    expect(result.deniedEntity).toBe("api_key:k1");

    // Verify neither entity was reserved (atomic rollback)
    const state = await stub.getBudgetState();
    const userBudget = state.find((b) => b.entity_type === "user");
    const keyBudget = state.find((b) => b.entity_type === "api_key");
    expect(userBudget!.reserved).toBe(0);
    expect(keyBudget!.reserved).toBe(0);
  });

  it("approves with empty entities array — no reservationId, no reservation stored", async () => {
    const stub = getStub("user-empty-entities");
    const result = await stub.checkAndReserve([], 10_000_000);
    expect(result.status).toBe("approved");
    expect(result.reservationId).toBeUndefined();
  });

  it("approves when entities have no budget rows — no reservationId", async () => {
    const stub = getStub("user-no-budget-rows");
    const result = await stub.checkAndReserve(
      [{ type: "user", id: "nonexistent" }], 10_000_000,
    );
    expect(result.status).toBe("approved");
    expect(result.reservationId).toBeUndefined();
  });

  it("approves at exact boundary (spend + reserved + estimate === maxBudget)", async () => {
    const stub = getStub("user-exact-boundary");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 30_000_000, "strict_block", null, 0);

    const result = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }], 20_000_000,
    );
    expect(result.status).toBe("approved");
    expect(result.reservationId).toBeDefined();
  });

  it("serializes concurrent requests correctly", async () => {
    const stub = getStub("user-concurrent-1");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    const [r1, r2] = await Promise.all([
      stub.checkAndReserve([{ type: "user", id: "u1" }], 30_000_000),
      stub.checkAndReserve([{ type: "user", id: "u1" }], 30_000_000),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual(["approved", "denied"]);
  });

  // ── Policy enforcement ───────────────────────────────────────────

  it("soft_block allows over-budget requests", async () => {
    const stub = getStub("user-soft-block");
    await stub.populateIfEmpty("user", "u1", 10_000_000, 10_000_000, "soft_block", null, 0);

    const result = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }], 5_000_000,
    );
    expect(result.status).toBe("approved");
  });

  it("warn allows over-budget requests", async () => {
    const stub = getStub("user-warn");
    await stub.populateIfEmpty("user", "u1", 10_000_000, 10_000_000, "warn", null, 0);

    const result = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }], 5_000_000,
    );
    expect(result.status).toBe("approved");
  });

  // ── reconcile ────────────────────────────────────────────────────

  it("reconcile updates spend and clears reserved", async () => {
    const stub = getStub("user-reconcile-1");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    const check = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }], 10_000_000,
    );
    expect(check.status).toBe("approved");

    const reconcileResult = await stub.reconcile(check.reservationId!, 7_000_000);
    expect(reconcileResult.status).toBe("reconciled");
    expect(reconcileResult.spends!["user:u1"]).toBe(7_000_000);

    const state = await stub.getBudgetState();
    expect(state[0].spend).toBe(7_000_000);
    expect(state[0].reserved).toBe(0);
  });

  it("reconcile with unknown reservation returns not_found", async () => {
    const stub = getStub("user-reconcile-notfound");
    const result = await stub.reconcile("nonexistent-id", 5_000_000);
    expect(result).toEqual({ status: "not_found" });
  });

  it("reconcile with actualCost = 0 clears reserved without changing spend", async () => {
    const stub = getStub("user-reconcile-zero");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 10_000_000, "strict_block", null, 0);

    const check = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }], 5_000_000,
    );
    expect(check.status).toBe("approved");

    const result = await stub.reconcile(check.reservationId!, 0);
    expect(result.status).toBe("reconciled");

    const state = await stub.getBudgetState();
    expect(state[0].spend).toBe(10_000_000); // Unchanged
    expect(state[0].reserved).toBe(0); // Cleared
  });

  it("double reconcile returns not_found on second call", async () => {
    const stub = getStub("user-reconcile-double");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    const check = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }], 10_000_000,
    );
    const r1 = await stub.reconcile(check.reservationId!, 5_000_000);
    expect(r1.status).toBe("reconciled");

    const r2 = await stub.reconcile(check.reservationId!, 5_000_000);
    expect(r2.status).toBe("not_found");

    // Spend should not be double-counted
    const state = await stub.getBudgetState();
    expect(state[0].spend).toBe(5_000_000);
  });

  it("reconcile updates spend across multiple entities", async () => {
    const stub = getStub("user-reconcile-multi");
    await stub.populateIfEmpty("user", "u1", 100_000_000, 0, "strict_block", null, 0);
    await stub.populateIfEmpty("api_key", "k1", 100_000_000, 0, "strict_block", null, 0);

    const check = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }, { type: "api_key", id: "k1" }],
      10_000_000,
    );
    expect(check.status).toBe("approved");

    const result = await stub.reconcile(check.reservationId!, 7_000_000);
    expect(result.status).toBe("reconciled");
    expect(result.spends!["user:u1"]).toBe(7_000_000);
    expect(result.spends!["api_key:k1"]).toBe(7_000_000);

    const state = await stub.getBudgetState();
    const userBudget = state.find((b) => b.entity_type === "user");
    const keyBudget = state.find((b) => b.entity_type === "api_key");
    expect(userBudget!.spend).toBe(7_000_000);
    expect(userBudget!.reserved).toBe(0);
    expect(keyBudget!.spend).toBe(7_000_000);
    expect(keyBudget!.reserved).toBe(0);
  });

  // ── Inline period reset ──────────────────────────────────────────

  it("resets spend on expired daily budget period", async () => {
    const stub = getStub("user-period-reset");
    const yesterday = Date.now() - 2 * 86_400_000; // 2 days ago
    await stub.populateIfEmpty(
      "user", "u1", 50_000_000, 50_000_000, "strict_block", "daily", yesterday,
    );

    // Budget is fully spent, but period has expired — should reset and approve
    const result = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }], 10_000_000,
    );
    expect(result.status).toBe("approved");

    const state = await stub.getBudgetState();
    expect(state[0].spend).toBe(0); // Reset
    expect(state[0].reserved).toBe(10_000_000); // New reservation
    expect(state[0].period_start).toBeGreaterThan(yesterday);
  });

  it("returns periodResets array when daily budget period has expired", async () => {
    const stub = getStub("user-period-reset-returns");
    const twoDaysAgo = Date.now() - 2 * 86_400_000;
    await stub.populateIfEmpty(
      "user", "u1", 50_000_000, 50_000_000, "strict_block", "daily", twoDaysAgo,
    );

    const result = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }], 10_000_000,
    );

    expect(result.periodResets).toBeDefined();
    expect(result.periodResets).toHaveLength(1);
    expect(result.periodResets![0].entityType).toBe("user");
    expect(result.periodResets![0].entityId).toBe("u1");
    expect(result.periodResets![0].newPeriodStart).toBeGreaterThan(twoDaysAgo);
  });

  it("returns no periodResets when period is current", async () => {
    const stub = getStub("user-period-current");
    const recentStart = Date.now() - 1_000; // 1 second ago
    await stub.populateIfEmpty(
      "user", "u1", 50_000_000, 10_000_000, "strict_block", "daily", recentStart,
    );

    const result = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }], 5_000_000,
    );

    expect(result.status).toBe("approved");
    expect(result.periodResets).toBeUndefined();
  });

  it("returns periodResets even when denied (reset entity A, deny on entity B)", async () => {
    const stub = getStub("user-period-reset-denied");
    const twoDaysAgo = Date.now() - 2 * 86_400_000;
    // Entity A: expired period, will reset
    await stub.populateIfEmpty(
      "user", "u1", 100_000_000, 90_000_000, "strict_block", "daily", twoDaysAgo,
    );
    // Entity B: nearly full, current period, will deny
    await stub.populateIfEmpty(
      "api_key", "k1", 10_000_000, 9_500_000, "strict_block", null, 0,
    );

    const result = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }, { type: "api_key", id: "k1" }],
      5_000_000,
    );

    expect(result.status).toBe("denied");
    expect(result.deniedEntity).toBe("api_key:k1");
    // Period reset from entity A should still be recorded
    expect(result.periodResets).toBeDefined();
    expect(result.periodResets).toHaveLength(1);
    expect(result.periodResets![0].entityType).toBe("user");
  });

  // ── Alarm ────────────────────────────────────────────────────────

  it("alarm cleans up expired reservations", async () => {
    const stub = getStub("user-alarm-1");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    // Reserve with very short TTL
    const result = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }], 10_000_000, 1,
    );
    expect(result.status).toBe("approved");

    // Wait for expiry then trigger alarm
    await new Promise((r) => setTimeout(r, 10));
    await runDurableObjectAlarm(stub);

    const state = await stub.getBudgetState();
    expect(state[0].reserved).toBe(0); // Cleaned up
  });

  // ── getBudgetState reflects mutations ─────────────────────────────

  it("getBudgetState reflects full lifecycle", async () => {
    const stub = getStub("user-lifecycle");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    const check = await stub.checkAndReserve(
      [{ type: "user", id: "u1" }], 10_000_000,
    );
    let state = await stub.getBudgetState();
    expect(state[0].reserved).toBe(10_000_000);
    expect(state[0].spend).toBe(0);

    await stub.reconcile(check.reservationId!, 7_000_000);
    state = await stub.getBudgetState();
    expect(state[0].reserved).toBe(0);
    expect(state[0].spend).toBe(7_000_000);
  });
});

// ── currentPeriodStart unit tests ────────────────────────────────────

import { currentPeriodStart } from "../durable-objects/user-budget.js";

describe("currentPeriodStart", () => {
  it("advances monthly across year boundaries", () => {
    // Start: Nov 1 2025 UTC
    const start = Date.UTC(2025, 10, 1); // month is 0-indexed
    // Now: Feb 15 2026 UTC
    const now = Date.UTC(2026, 1, 15);

    const result = currentPeriodStart("monthly", start, now);
    // Should advance to Feb 1 2026
    expect(result).toBe(Date.UTC(2026, 1, 1));
  });

  it("advances yearly correctly", () => {
    const start = Date.UTC(2024, 0, 1); // Jan 1 2024
    const now = Date.UTC(2026, 5, 15); // Jun 15 2026

    const result = currentPeriodStart("yearly", start, now);
    expect(result).toBe(Date.UTC(2026, 0, 1)); // Jan 1 2026
  });

  it("returns start unchanged for unknown interval", () => {
    const start = Date.UTC(2025, 0, 1);
    const now = Date.UTC(2026, 0, 1);
    expect(currentPeriodStart("unknown", start, now)).toBe(start);
  });
});
