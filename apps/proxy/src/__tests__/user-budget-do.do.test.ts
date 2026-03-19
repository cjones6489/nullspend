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
    const check = await stub.checkAndReserve(null,5_000_000);
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
    const check = await stub.checkAndReserve(null,10_000_000);
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
    await stub.checkAndReserve(null,1_000);

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

    const result = await stub.checkAndReserve(null, 20_000_000);
    expect(result.status).toBe("approved");
    expect(result.hasBudgets).toBe(true);
    expect(result.reservationId).toBeDefined();
    expect(typeof result.reservationId).toBe("string");
    expect(result.checkedEntities).toHaveLength(1);
    expect(result.checkedEntities![0].entityType).toBe("user");
  });

  it("denies when estimate exceeds remaining budget", async () => {
    const stub = getStub("user-deny-1");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 40_000_000, "strict_block", null, 0);

    const result = await stub.checkAndReserve(null, 20_000_000,
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

    const result = await stub.checkAndReserve("k1",
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

  it("empty DO with no budgets returns hasBudgets=false", async () => {
    const stub = getStub("user-empty-entities");
    const result = await stub.checkAndReserve(null, 10_000_000);
    expect(result.status).toBe("approved");
    expect(result.hasBudgets).toBe(false);
    expect(result.reservationId).toBeUndefined();
  });

  it("keyId=null only checks user-level budgets (ignores api_key)", async () => {
    const stub = getStub("user-no-budget-rows");
    // Only api_key budget — no user-level budget
    await stub.populateIfEmpty("api_key", "k1", 10_000_000, 0, "strict_block", null, 0);

    const result = await stub.checkAndReserve(null, 10_000_000);
    expect(result.status).toBe("approved");
    expect(result.hasBudgets).toBe(false);
  });

  it("keyId filters to matching api_key budget only", async () => {
    const stub = getStub("user-keyid-filter");
    await stub.populateIfEmpty("user", "u1", 100_000_000, 0, "strict_block", null, 0);
    await stub.populateIfEmpty("api_key", "k1", 10_000_000, 9_500_000, "strict_block", null, 0);
    await stub.populateIfEmpty("api_key", "k2", 10_000_000, 0, "strict_block", null, 0);

    // Request with k1 — should be denied (k1 nearly full)
    const r1 = await stub.checkAndReserve("k1", 1_000_000);
    expect(r1.status).toBe("denied");
    expect(r1.deniedEntity).toBe("api_key:k1");

    // Request with k2 — should be approved (k2 has room, k1 ignored)
    const r2 = await stub.checkAndReserve("k2", 1_000_000);
    expect(r2.status).toBe("approved");
    expect(r2.hasBudgets).toBe(true);
  });

  it("approves at exact boundary (spend + reserved + estimate === maxBudget)", async () => {
    const stub = getStub("user-exact-boundary");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 30_000_000, "strict_block", null, 0);

    const result = await stub.checkAndReserve(null, 20_000_000,
    );
    expect(result.status).toBe("approved");
    expect(result.reservationId).toBeDefined();
  });

  it("serializes concurrent requests correctly", async () => {
    const stub = getStub("user-concurrent-1");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    const [r1, r2] = await Promise.all([
      stub.checkAndReserve(null,30_000_000),
      stub.checkAndReserve(null,30_000_000),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual(["approved", "denied"]);
  });

  // ── Policy enforcement ───────────────────────────────────────────

  it("soft_block allows over-budget requests", async () => {
    const stub = getStub("user-soft-block");
    await stub.populateIfEmpty("user", "u1", 10_000_000, 10_000_000, "soft_block", null, 0);

    const result = await stub.checkAndReserve(null, 5_000_000,
    );
    expect(result.status).toBe("approved");
  });

  it("warn allows over-budget requests", async () => {
    const stub = getStub("user-warn");
    await stub.populateIfEmpty("user", "u1", 10_000_000, 10_000_000, "warn", null, 0);

    const result = await stub.checkAndReserve(null, 5_000_000,
    );
    expect(result.status).toBe("approved");
  });

  // ── reconcile ────────────────────────────────────────────────────

  it("reconcile updates spend and clears reserved", async () => {
    const stub = getStub("user-reconcile-1");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    const check = await stub.checkAndReserve(null, 10_000_000,
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

    const check = await stub.checkAndReserve(null, 5_000_000,
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

    const check = await stub.checkAndReserve(null, 10_000_000,
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

    const check = await stub.checkAndReserve("k1",
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

  // ── reconcile with missing budgets ─────────────────────────────

  it("reconcile after removeBudget returns budgetsMissing", async () => {
    const stub = getStub("user-reconcile-missing");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    const check = await stub.checkAndReserve(null, 10_000_000,
    );
    expect(check.status).toBe("approved");

    // Remove the budget before reconciling
    await stub.removeBudget("user", "u1");

    const result = await stub.reconcile(check.reservationId!, 7_000_000);
    expect(result.status).toBe("reconciled");
    expect(result.budgetsMissing).toEqual(["user:u1"]);
    expect(result.spends!["user:u1"]).toBeUndefined();
  });

  it("reconcile with partial missing budgets", async () => {
    const stub = getStub("user-reconcile-partial-missing");
    await stub.populateIfEmpty("user", "u1", 100_000_000, 0, "strict_block", null, 0);
    await stub.populateIfEmpty("api_key", "k1", 100_000_000, 0, "strict_block", null, 0);

    const check = await stub.checkAndReserve("k1",
      10_000_000,
    );
    expect(check.status).toBe("approved");

    // Remove only user budget
    await stub.removeBudget("user", "u1");

    const result = await stub.reconcile(check.reservationId!, 7_000_000);
    expect(result.status).toBe("reconciled");
    expect(result.budgetsMissing).toEqual(["user:u1"]);
    expect(result.spends!["user:u1"]).toBeUndefined();
    expect(result.spends!["api_key:k1"]).toBe(7_000_000);
  });

  // ── Inline period reset ──────────────────────────────────────────

  it("resets spend on expired daily budget period", async () => {
    const stub = getStub("user-period-reset");
    const yesterday = Date.now() - 2 * 86_400_000; // 2 days ago
    await stub.populateIfEmpty(
      "user", "u1", 50_000_000, 50_000_000, "strict_block", "daily", yesterday,
    );

    // Budget is fully spent, but period has expired — should reset and approve
    const result = await stub.checkAndReserve(null, 10_000_000,
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

    const result = await stub.checkAndReserve(null, 10_000_000,
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

    const result = await stub.checkAndReserve(null, 5_000_000,
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

    const result = await stub.checkAndReserve("k1",
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
    const result = await stub.checkAndReserve(null, 10_000_000, 1,
    );
    expect(result.status).toBe("approved");

    // Wait for expiry then trigger alarm
    await new Promise((r) => setTimeout(r, 10));
    await runDurableObjectAlarm(stub);

    const state = await stub.getBudgetState();
    expect(state[0].reserved).toBe(0); // Cleaned up
  });

  // ── removeBudget ─────────────────────────────────────────────────

  it("removeBudget removes existing budget", async () => {
    const stub = getStub("user-remove-1");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 10_000_000, "strict_block", null, 0);
    await stub.populateIfEmpty("api_key", "k1", 20_000_000, 0, "strict_block", null, 0);

    await stub.removeBudget("user", "u1");

    const state = await stub.getBudgetState();
    expect(state).toHaveLength(1);
    expect(state[0].entity_type).toBe("api_key");

    // checkAndReserve should skip removed entity (no budget = no limit)
    const result = await stub.checkAndReserve("k1",
      15_000_000,
    );
    expect(result.status).toBe("approved");
  });

  it("removeBudget on non-existent entity is a no-op (idempotent)", async () => {
    const stub = getStub("user-remove-noop");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    // Remove something that doesn't exist
    await stub.removeBudget("api_key", "nonexistent");

    const state = await stub.getBudgetState();
    expect(state).toHaveLength(1);
  });

  it("removeBudget with outstanding reservations: alarm handles orphaned rows", async () => {
    const stub = getStub("user-remove-orphan");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    // Create a reservation
    const check = await stub.checkAndReserve(null, 10_000_000, 1,
    );
    expect(check.status).toBe("approved");

    // Remove budget while reservation outstanding
    await stub.removeBudget("user", "u1");

    // Budget is gone
    const state = await stub.getBudgetState();
    expect(state).toHaveLength(0);

    // Alarm cleanup should not crash (UPDATE on missing row is a no-op)
    await new Promise((r) => setTimeout(r, 10));
    await runDurableObjectAlarm(stub);
  });

  // ── resetSpend ──────────────────────────────────────────────────

  it("resetSpend zeros spend/reserved and updates period_start", async () => {
    const stub = getStub("user-reset-1");
    const oldPeriodStart = Date.now() - 86_400_000;
    await stub.populateIfEmpty("user", "u1", 50_000_000, 30_000_000, "strict_block", "daily", oldPeriodStart);

    // Add a reservation
    const check = await stub.checkAndReserve(null, 5_000_000,
    );
    expect(check.status).toBe("approved");

    const beforeReset = Date.now();
    await stub.resetSpend("user", "u1");

    const state = await stub.getBudgetState();
    expect(state[0].spend).toBe(0);
    expect(state[0].reserved).toBe(0);
    expect(state[0].period_start).toBeGreaterThanOrEqual(beforeReset);
  });

  it("resetSpend on non-existent entity is a no-op (idempotent)", async () => {
    const stub = getStub("user-reset-noop");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 10_000_000, "strict_block", null, 0);

    await stub.resetSpend("api_key", "nonexistent");

    const state = await stub.getBudgetState();
    expect(state).toHaveLength(1);
    expect(state[0].spend).toBe(10_000_000); // unchanged
  });

  it("after resetSpend, full budget is available again", async () => {
    const stub = getStub("user-reset-avail");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 50_000_000, "strict_block", null, 0);

    // Budget is fully spent — should deny
    const denied = await stub.checkAndReserve(null, 1_000,
    );
    expect(denied.status).toBe("denied");

    await stub.resetSpend("user", "u1");

    // After reset — full budget available
    const approved = await stub.checkAndReserve(null, 49_000_000,
    );
    expect(approved.status).toBe("approved");
  });

  it("resetSpend deletes orphaned reservations", async () => {
    const stub = getStub("user-reset-orphan");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    const check = await stub.checkAndReserve(null, 10_000_000,
    );
    expect(check.status).toBe("approved");

    await stub.resetSpend("user", "u1");

    // Old reservation should be gone — reconcile returns not_found
    const result = await stub.reconcile(check.reservationId!, 10_000_000);
    expect(result.status).toBe("not_found");

    // Spend should still be 0 (orphan didn't reconcile)
    const state = await stub.getBudgetState();
    expect(state[0].spend).toBe(0);
  });

  it("resetSpend decrements reserved on co-covered entities", async () => {
    const stub = getStub("user-reset-multi");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);
    await stub.populateIfEmpty("api_key", "k1", 50_000_000, 0, "strict_block", null, 0);

    // Multi-entity reservation covering both user:u1 and api_key:k1
    const check = await stub.checkAndReserve("k1", 10_000_000,
    );
    expect(check.status).toBe("approved");

    // Reset only api_key:k1
    await stub.resetSpend("api_key", "k1");

    // user:u1's reserved should be decremented (reservation cleaned up)
    const state = await stub.getBudgetState();
    const userBudget = state.find((b) => b.entity_type === "user");
    expect(userBudget!.reserved).toBe(0);
  });

  it("no over-spend after resetSpend with outstanding reservation", async () => {
    const stub = getStub("user-reset-nospend");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    // Create reservation, then reset
    const check = await stub.checkAndReserve(null, 10_000_000,
    );
    await stub.resetSpend("user", "u1");

    // Old reservation is gone
    const reconcileResult = await stub.reconcile(check.reservationId!, 10_000_000);
    expect(reconcileResult.status).toBe("not_found");

    // Full budget should be available — reserve up to the limit
    const fullReserve = await stub.checkAndReserve(null, 50_000_000,
    );
    expect(fullReserve.status).toBe("approved");

    // Nothing beyond should be allowed
    const overReserve = await stub.checkAndReserve(null, 1,
    );
    expect(overReserve.status).toBe("denied");
  });

  // ── getBudgetState reflects mutations ─────────────────────────────

  it("getBudgetState reflects full lifecycle", async () => {
    const stub = getStub("user-lifecycle");
    await stub.populateIfEmpty("user", "u1", 50_000_000, 0, "strict_block", null, 0);

    const check = await stub.checkAndReserve(null, 10_000_000,
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
