import type { Redis } from "@upstash/redis/cloudflare";
import { reconcile } from "./budget.js";
import type { BudgetEntity } from "./budget-lookup.js";
import { updateBudgetSpend } from "./budget-spend.js";
import { emitMetric } from "./metrics.js";

const PG_MAX_RETRIES = 2;
const PG_RETRY_DELAYS = [200, 800];

/**
 * Never-throwing helper that reconciles a budget reservation and updates
 * Postgres spend. Always called inside `waitUntil`.
 *
 * Retries the Postgres write up to PG_MAX_RETRIES times with backoff
 * to prevent Redis/Postgres split-brain on transient failures.
 */
export async function reconcileReservation(
  redis: Redis,
  reservationId: string,
  actualCostMicrodollars: number,
  budgetEntities: BudgetEntity[],
  connectionString: string,
): Promise<void> {
  const startMs = Date.now();
  let retries = 0;
  let status = "ok";

  try {
    const entityKeys = budgetEntities.map((e) => e.entityKey);
    await reconcile(redis, reservationId, entityKeys, actualCostMicrodollars);

    if (actualCostMicrodollars > 0) {
      const entities = budgetEntities.map((e) => ({
        entityType: e.entityType,
        entityId: e.entityId,
      }));

      let pgSuccess = false;

      for (let attempt = 0; attempt <= PG_MAX_RETRIES; attempt++) {
        try {
          await updateBudgetSpend(connectionString, entities, actualCostMicrodollars);
          pgSuccess = true;
          retries = attempt;
          break;
        } catch (err) {
          if (attempt < PG_MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, PG_RETRY_DELAYS[attempt]));
          } else {
            retries = attempt;
            console.error("[budget-reconcile] Postgres write failed after retries", {
              reservationId,
              actualCostMicrodollars,
              entities: entities.map((e) => `${e.entityType}:${e.entityId}`),
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      if (!pgSuccess) {
        status = "pg_failed";
        console.error("[budget-reconcile] Redis/Postgres split-brain: reservation", reservationId);
      }
    }
  } catch (err) {
    status = "error";
    console.error("[budget] Reconciliation failed:", err);
  } finally {
    emitMetric("reconciliation", {
      status,
      costMicrodollars: actualCostMicrodollars,
      durationMs: Date.now() - startMs,
      retries,
    });
  }
}
