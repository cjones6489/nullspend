import { getSubscriptionByOrgId } from "@/lib/stripe/subscription";
import { getTierForUser, TIERS, type Tier } from "@/lib/stripe/tiers";
import { LimitExceededError, SpendCapExceededError } from "@/lib/utils/http";

type CountLimitKey = "maxBudgets" | "maxApiKeys" | "maxWebhookEndpoints" | "maxTeamMembers";
type AmountLimitKey = "spendCapMicrodollars";

export interface OrgTierInfo {
  tier: Tier;
  label: string;
}

/**
 * Resolve the effective tier for an org.
 * Returns the tier name and label for use in error messages.
 */
export async function resolveOrgTier(orgId: string): Promise<OrgTierInfo> {
  const subscription = await getSubscriptionByOrgId(orgId);
  const tier = getTierForUser(subscription);
  return { tier, label: TIERS[tier].label };
}

/**
 * Assert that the current count is below the tier limit for a count-based resource.
 * Throws LimitExceededError (→ 409) if the limit is exceeded.
 *
 * Skips the check if the limit is Infinity (paid tiers with unlimited resources).
 */
export function assertCountBelowLimit(
  tierInfo: OrgTierInfo,
  limitKey: CountLimitKey,
  currentCount: number,
  resourceLabel: string,
): void {
  const limit = TIERS[tierInfo.tier][limitKey];
  if (limit === Infinity) return;

  if (currentCount >= limit) {
    throw new LimitExceededError(
      `Maximum of ${limit} ${resourceLabel} allowed on the ${tierInfo.label} plan. Upgrade for more.`,
    );
  }
}

/**
 * Assert that an amount is within the tier's spend cap.
 * Throws SpendCapExceededError (→ 400 spend_cap_exceeded) if exceeded.
 */
export function assertAmountBelowCap(
  tierInfo: OrgTierInfo,
  limitKey: AmountLimitKey,
  amount: number,
): void {
  const cap = TIERS[tierInfo.tier][limitKey];
  if (cap === Infinity) return;

  if (amount > cap) {
    throw new SpendCapExceededError(
      `Budget amount exceeds your ${tierInfo.label} tier spend cap of $${(cap / 1_000_000).toLocaleString()}. Upgrade your plan to increase your limit.`,
    );
  }
}
