"use client";

import { useSubscription } from "@/lib/queries/subscription";
import { getTierForUser, TIERS, type Tier } from "@/lib/stripe/tiers";

export interface OrgTierState {
  tier: Tier;
  label: string;
  limits: (typeof TIERS)[Tier];
  isLoading: boolean;
}

const TIER_ORDER: Record<Tier, number> = { free: 0, pro: 1, enterprise: 2 };

/**
 * Derives the org's effective tier from the subscription query.
 * Returns tier name, label, limits, and loading state.
 *
 * While loading, `tier` defaults to `"free"`. Consumers that conditionally
 * render based on tier should check `isLoading` first to avoid flash of
 * gated content (see `TierGate` for an example).
 */
export function useOrgTier(): OrgTierState {
  const { data: subscription, isLoading } = useSubscription();

  const tier = getTierForUser(subscription ?? null);
  return {
    tier,
    label: TIERS[tier].label,
    limits: TIERS[tier],
    isLoading,
  };
}

/** True when `current` is at least `required` in the tier hierarchy. */
export function isAtLeastTier(current: Tier, required: Tier): boolean {
  return TIER_ORDER[current] >= TIER_ORDER[required];
}
