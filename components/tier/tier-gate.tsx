"use client";

import type { ReactNode } from "react";
import { useOrgTier, isAtLeastTier } from "@/lib/hooks/use-org-tier";
import { UpgradeCard } from "@/components/tier/upgrade-card";
import type { Tier } from "@/lib/stripe/tiers";

interface TierGateProps {
  /** Minimum tier required to see the children. */
  requiredTier: Tier;
  /** Human-readable feature name shown in the upgrade prompt. */
  feature: string;
  children: ReactNode;
  /** What to render when the tier is insufficient. Defaults to `<UpgradeCard>`. */
  fallback?: ReactNode;
}

/**
 * Conditionally renders children when the org's tier meets the requirement.
 * Shows an inline upgrade card otherwise.
 */
export function TierGate({
  requiredTier,
  feature,
  children,
  fallback,
}: TierGateProps) {
  const { tier, isLoading } = useOrgTier();

  if (isLoading) return null;

  if (isAtLeastTier(tier, requiredTier)) {
    return <>{children}</>;
  }

  return (
    <>
      {fallback ?? (
        <UpgradeCard feature={feature} requiredTier={requiredTier} />
      )}
    </>
  );
}
