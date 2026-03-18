import type { CheckResult } from "../durable-objects/user-budget.js";
import type { DOBudgetEntity } from "./budget-do-lookup.js";
import { updateBudgetSpend } from "./budget-spend.js";
import { emitMetric } from "./metrics.js";

const PG_MAX_RETRIES = 2;
const PG_RETRY_DELAYS = [200, 800];

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
 * Never throws — errors are caught, logged, and metrics emitted.
 *
 * Returns the reconciliation status:
 * - `"ok"`: DO reconcile + Postgres write both succeeded (or actualCost=0, no PG write needed)
 * - `"pg_failed"`: DO reconcile succeeded but Postgres write failed after retries (split-brain)
 * - `"error"`: DO reconcile itself failed
 *
 * Retries the Postgres write up to PG_MAX_RETRIES times with backoff
 * to prevent DO/Postgres split-brain on transient failures.
 */
export async function doBudgetReconcile(
  env: Env,
  userId: string,
  reservationId: string,
  actualCost: number,
  entities: Array<{ entityType: string; entityId: string }>,
  connectionString: string,
): Promise<"ok" | "pg_failed" | "error"> {
  const startMs = Date.now();
  let retries = 0;
  let status: "ok" | "pg_failed" | "error" = "ok";

  try {
    const stub = env.USER_BUDGET.get(env.USER_BUDGET.idFromName(userId));
    await stub.reconcile(reservationId, actualCost);

    if (actualCost > 0) {
      let pgSuccess = false;

      for (let attempt = 0; attempt <= PG_MAX_RETRIES; attempt++) {
        try {
          await updateBudgetSpend(connectionString, entities, actualCost);
          pgSuccess = true;
          retries = attempt;
          break;
        } catch (err) {
          if (attempt < PG_MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, PG_RETRY_DELAYS[attempt]));
          } else {
            retries = attempt;
            console.error("[budget-do-client] Postgres write failed after retries", {
              reservationId,
              actualCost,
              entities: entities.map((e) => `${e.entityType}:${e.entityId}`),
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      if (!pgSuccess) {
        status = "pg_failed";
        console.error("[budget-do-client] DO/Postgres split-brain: reservation", reservationId);
      }
    }
  } catch (err) {
    status = "error";
    console.error("[budget-do-client] Reconciliation failed:", err);
  } finally {
    emitMetric("do_reconciliation", {
      status,
      costMicrodollars: actualCost,
      durationMs: Date.now() - startMs,
      retries,
    });
  }

  return status;
}

/**
 * Remove a budget entity from the UserBudgetDO.
 * Throws on DO error (fail-closed).
 */
export async function doBudgetRemove(
  env: Env,
  userId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  const stub = env.USER_BUDGET.get(env.USER_BUDGET.idFromName(userId));
  await stub.removeBudget(entityType, entityId);
}

/**
 * Reset spend for a budget entity in the UserBudgetDO.
 * Throws on DO error (fail-closed).
 */
export async function doBudgetResetSpend(
  env: Env,
  userId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  const stub = env.USER_BUDGET.get(env.USER_BUDGET.idFromName(userId));
  await stub.resetSpend(entityType, entityId);
}

/**
 * Sync all DO budget entities from Postgres via a single `syncBudgets` RPC.
 * UPSERTs config fields and purges ghost rows (budgets deleted from Postgres
 * but still present in the DO). Emits a metric when ghost rows are purged.
 */
export async function doBudgetPopulate(
  env: Env,
  userId: string,
  entities: DOBudgetEntity[],
): Promise<void> {
  const stub = env.USER_BUDGET.get(env.USER_BUDGET.idFromName(userId));
  const purged = await stub.syncBudgets(
    entities.map((e) => ({
      entityType: e.entityType,
      entityId: e.entityId,
      maxBudget: e.maxBudget,
      spend: e.spend,
      policy: e.policy,
      resetInterval: e.resetInterval,
      periodStart: e.periodStart,
    })),
  );
  if (purged > 0) {
    emitMetric("do_ghost_budget_purge", { userId, purged });
  }
}
