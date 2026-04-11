import type { WebhookEvent } from "@/lib/webhooks/dispatch";
import type { HealthTier } from "./margin-query";
import { computeHealthTier } from "./margin-query";

const CURRENT_API_VERSION = "2026-04-01";

/**
 * Build a margin.threshold_crossed webhook event.
 * Only fires on worsening tier transitions.
 */
export function buildMarginThresholdPayload(
  data: {
    stripeCustomerId: string;
    customerName: string | null;
    tagValue: string;
    previousMarginPercent: number;
    currentMarginPercent: number;
    revenueMicrodollars: number;
    costMicrodollars: number;
    period: string;
  },
  apiVersion: string = CURRENT_API_VERSION,
): WebhookEvent {
  const previousTier = computeHealthTier(data.previousMarginPercent);
  const currentTier = computeHealthTier(data.currentMarginPercent);

  return {
    id: `evt_${crypto.randomUUID()}`,
    type: "margin.threshold_crossed",
    api_version: apiVersion,
    created_at: Math.floor(Date.now() / 1000),
    data: {
      object: {
        customer: {
          stripeId: data.stripeCustomerId,
          name: data.customerName,
          tagValue: data.tagValue,
        },
        margin: {
          previous: data.previousMarginPercent / 100,
          current: data.currentMarginPercent / 100,
          previousTier,
          currentTier,
        },
        revenue_microdollars: data.revenueMicrodollars,
        cost_microdollars: data.costMicrodollars,
        period: data.period,
      },
    },
  };
}

const TIER_SEVERITY: Record<HealthTier, number> = {
  healthy: 0,
  moderate: 1,
  at_risk: 2,
  critical: 3,
};

/**
 * Detect threshold crossings that are worsening (not improving).
 */
/**
 * MRG-2: Accept optional pre-computed healthTier to avoid the zero-revenue
 * critical→at_risk downgrade. When healthTier is provided, use it directly
 * instead of recomputing from marginPercent (which gives wrong result for
 * zero-revenue customers where marginPercent=0 but tier should be "critical").
 */
export function detectWorseningCrossings(
  previous: { tagValue: string; marginPercent: number; healthTier?: HealthTier }[],
  current: { tagValue: string; marginPercent: number; healthTier?: HealthTier }[],
): { tagValue: string; previousMarginPercent: number; currentMarginPercent: number }[] {
  const prevMap = new Map(previous.map((p) => [p.tagValue, { marginPercent: p.marginPercent, tier: p.healthTier ?? computeHealthTier(p.marginPercent) }]));
  const crossings: { tagValue: string; previousMarginPercent: number; currentMarginPercent: number }[] = [];

  for (const c of current) {
    const prev = prevMap.get(c.tagValue);
    if (prev === undefined) continue;

    const prevTier = prev.tier;
    const currTier = c.healthTier ?? computeHealthTier(c.marginPercent);

    // Only fire on worsening
    if (TIER_SEVERITY[currTier] > TIER_SEVERITY[prevTier]) {
      crossings.push({
        tagValue: c.tagValue,
        previousMarginPercent: prev.marginPercent,
        currentMarginPercent: c.marginPercent,
      });
    }
  }

  return crossings;
}
