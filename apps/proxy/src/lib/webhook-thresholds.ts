import type { BudgetEntity } from "./budget-do-lookup.js";
import { buildThresholdPayload, type WebhookEvent } from "./webhook-events.js";

const THRESHOLDS = [50, 80, 90, 95];

/**
 * Detect budget threshold crossings after a cost event.
 *
 * Compares the pre-request spend against the post-request spend to find
 * thresholds that were crossed by this specific request.
 *
 * // TODO: Redis dedup for threshold alerts (v1.1)
 * Currently, concurrent requests may both detect the same crossing.
 * Customer-side dedup by event type + entity is sufficient for launch.
 */
export function detectThresholdCrossings(
  budgetEntities: BudgetEntity[],
  costMicrodollars: number,
  requestId: string,
): WebhookEvent[] {
  const events: WebhookEvent[] = [];

  for (const entity of budgetEntities) {
    if (entity.maxBudget <= 0) continue;

    const previousSpend = entity.spend;
    const newSpend = previousSpend + costMicrodollars;

    const previousPercent = Math.floor((previousSpend / entity.maxBudget) * 100);
    const newPercent = Math.floor((newSpend / entity.maxBudget) * 100);

    // Find thresholds crossed by this request (were below before, at or above now)
    for (const threshold of THRESHOLDS) {
      if (previousPercent < threshold && newPercent >= threshold) {
        events.push(
          buildThresholdPayload({
            budgetEntityType: entity.entityType,
            budgetEntityId: entity.entityId,
            budgetLimitMicrodollars: entity.maxBudget,
            budgetSpendMicrodollars: newSpend,
            thresholdPercent: threshold,
            triggeredByRequestId: requestId,
          }),
        );
      }
    }
  }

  return events;
}
