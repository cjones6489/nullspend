import type { Redis } from "@upstash/redis/cloudflare";
import { reconcile } from "./budget.js";
import type { BudgetEntity } from "./budget-lookup.js";
import { updateBudgetSpend } from "./budget-spend.js";

/**
 * Never-throwing helper that reconciles a budget reservation and updates
 * Postgres spend. Always called inside `waitUntil`.
 */
export async function reconcileReservation(
  redis: Redis,
  reservationId: string,
  actualCostMicrodollars: number,
  budgetEntities: BudgetEntity[],
  connectionString: string,
): Promise<void> {
  try {
    const entityKeys = budgetEntities.map((e) => e.entityKey);
    await reconcile(redis, reservationId, entityKeys, actualCostMicrodollars);
    if (actualCostMicrodollars > 0) {
      const entities = budgetEntities.map((e) => ({
        entityType: e.entityType,
        entityId: e.entityId,
      }));
      await updateBudgetSpend(connectionString, entities, actualCostMicrodollars);
    }
  } catch (err) {
    console.error("[budget] Reconciliation failed:", err);
  }
}
