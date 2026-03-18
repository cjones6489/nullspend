import type { CheckResult } from "../durable-objects/user-budget.js";
import type { DOBudgetEntity } from "./budget-do-lookup.js";
import { updateBudgetSpend } from "./budget-spend.js";

/**
 * Check budget via the UserBudgetDO.
 * Throws on DO error (fail-closed).
 */
export async function doBudgetCheck(
  env: Env,
  userId: string,
  entities: Array<{ type: string; id: string }>,
  estimateMicrodollars: number,
): Promise<CheckResult> {
  const stub = env.USER_BUDGET.get(env.USER_BUDGET.idFromName(userId));
  return await stub.checkAndReserve(entities, estimateMicrodollars);
}

/**
 * Reconcile a reservation via the UserBudgetDO + Postgres write-back.
 * Never throws — matches reconcileReservation contract.
 */
export async function doBudgetReconcile(
  env: Env,
  userId: string,
  reservationId: string,
  actualCost: number,
  entities: Array<{ entityType: string; entityId: string }>,
  connectionString: string,
): Promise<void> {
  try {
    const stub = env.USER_BUDGET.get(env.USER_BUDGET.idFromName(userId));
    await stub.reconcile(reservationId, actualCost);
    if (actualCost > 0) {
      await updateBudgetSpend(connectionString, entities, actualCost);
    }
  } catch (err) {
    console.error("[budget-do-client] Reconciliation failed:", err);
  }
}

/**
 * Populate the DO with budget entities from Postgres (cold start seeding).
 * Idempotent — skip-if-exists per entity.
 */
export async function doBudgetPopulate(
  env: Env,
  userId: string,
  entities: DOBudgetEntity[],
): Promise<void> {
  const stub = env.USER_BUDGET.get(env.USER_BUDGET.idFromName(userId));
  for (const entity of entities) {
    await stub.populateIfEmpty(
      entity.entityType,
      entity.entityId,
      entity.maxBudget,
      entity.spend,
      entity.policy,
      entity.resetInterval,
      entity.periodStart,
    );
  }
}
