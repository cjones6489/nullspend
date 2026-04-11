import type { WebhookEvent } from "@/lib/webhooks/dispatch";
import type { BudgetSpendEntity } from "./update-spend";

const DEFAULT_THRESHOLDS: readonly number[] = Object.freeze([50, 80, 90, 95]);
const CURRENT_API_VERSION = "2026-04-01";

/**
 * Detect budget threshold crossings after a cost event.
 *
 * Ported from the proxy's `detectThresholdCrossings` (apps/proxy/src/lib/webhook-thresholds.ts).
 * Same logic: compares pre/post spend percentages, emits warning/critical events.
 *
 * Also emits `budget.exceeded` when spend crosses 100%.
 */
export function detectThresholdCrossings(
  entities: BudgetSpendEntity[],
  requestId: string,
): WebhookEvent[] {
  const events: WebhookEvent[] = [];

  for (const entity of entities) {
    if (entity.maxBudget <= 0) continue;

    const previousPercent = Math.floor((entity.previousSpend / entity.maxBudget) * 100);
    const newPercent = Math.floor((entity.newSpend / entity.maxBudget) * 100);

    const thresholds = entity.thresholdPercentages.length > 0
      ? entity.thresholdPercentages
      : DEFAULT_THRESHOLDS;
    const lastThreshold = thresholds.length > 0 ? thresholds[thresholds.length - 1] : undefined;

    for (const threshold of thresholds) {
      if (previousPercent < threshold && newPercent >= threshold) {
        const isCritical = threshold === lastThreshold || threshold >= 90;
        events.push({
          id: `evt_${crypto.randomUUID()}`,
          type: isCritical
            ? "budget.threshold.critical"
            : "budget.threshold.warning",
          api_version: CURRENT_API_VERSION,
          created_at: Math.floor(Date.now() / 1000),
          data: {
            object: {
              budget_entity_type: entity.entityType,
              budget_entity_id: entity.entityId,
              budget_limit_microdollars: entity.maxBudget,
              budget_spend_microdollars: entity.newSpend,
              threshold_percent: threshold,
              triggered_by_request_id: requestId,
            },
          },
        });
      }
    }

    // budget.exceeded when crossing 100%
    // BDG-12: Only fire if 100 is not already in custom thresholds (prevents double-fire)
    const has100Threshold = thresholds.includes(100);
    if (previousPercent < 100 && newPercent >= 100 && !has100Threshold) {
      events.push({
        id: `evt_${crypto.randomUUID()}`,
        type: "budget.exceeded",
        api_version: CURRENT_API_VERSION,
        created_at: Math.floor(Date.now() / 1000),
        data: {
          object: {
            budget_entity_type: entity.entityType,
            budget_entity_id: entity.entityId,
            budget_limit_microdollars: entity.maxBudget,
            budget_spend_microdollars: entity.newSpend,
            triggered_by_request_id: requestId,
          },
        },
      });
    }
  }

  return events;
}
