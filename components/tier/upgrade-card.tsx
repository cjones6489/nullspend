"use client";

import { useOrgTier } from "@/lib/hooks/use-org-tier";
import { useCheckout } from "@/lib/queries/subscription";
import { TIERS, type Tier } from "@/lib/stripe/tiers";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface UpgradeCardProps {
  /** Human-readable feature name. */
  feature: string;
  /** Tier required to unlock this feature. */
  requiredTier: Tier;
  className?: string;
}

/**
 * Contextual upgrade prompt shown when a feature requires a higher tier.
 * Shows what the user unlocks and a one-click upgrade button.
 */
export function UpgradeCard({
  feature,
  requiredTier,
  className,
}: UpgradeCardProps) {
  const { tier: currentTier } = useOrgTier();
  const checkout = useCheckout();
  const target = TIERS[requiredTier];

  const priceId =
    requiredTier === "pro"
      ? process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID
      : undefined;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {feature}
          <Badge variant="secondary">{target.label}</Badge>
        </CardTitle>
        <CardDescription>
          This feature requires the {target.label} plan.
          {target.price != null && (
            <> Starting at ${target.price}/mo.</>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
          {requiredTier === "pro" && (
            <>
              <li>Unlimited budgets and API keys</li>
              <li>Up to 25 webhook endpoints</li>
              <li>90-day data retention</li>
              <li>Unlimited team members</li>
            </>
          )}
          {requiredTier === "enterprise" && (
            <>
              <li>Everything in Pro</li>
              <li>Unlimited webhook endpoints</li>
              <li>Unlimited data retention</li>
              <li>SSO/SAML &amp; custom RBAC</li>
            </>
          )}
        </ul>
      </CardContent>

      <CardFooter>
        {priceId ? (
          <Button
            onClick={() => checkout.mutate(priceId)}
            disabled={checkout.isPending}
          >
            {checkout.isPending ? "Redirecting..." : `Upgrade to ${target.label}`}
          </Button>
        ) : (
          <a
            href="mailto:sales@nullspend.com"
            className={buttonVariants({ variant: "outline" })}
          >
            Contact Sales
          </a>
        )}
        <span className="ml-2 text-xs text-muted-foreground">
          Currently on {TIERS[currentTier].label}
        </span>
      </CardFooter>
    </Card>
  );
}
