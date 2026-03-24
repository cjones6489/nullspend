"use client";

import { Check, CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCheckout,
  usePortalSession,
  useSubscription,
  useSyncCheckout,
} from "@/lib/queries/subscription";
import { useCostSummary } from "@/lib/queries/cost-event-summary";
import { TIERS, type Tier } from "@/lib/stripe/tiers";
import { formatMicrodollars } from "@/lib/utils/format";

export default function BillingPage() {
  const searchParams = useSearchParams();
  const { data: subscription, isLoading } = useSubscription();
  const { data: costData } = useCostSummary("30d");
  const checkout = useCheckout();
  const portal = usePortalSession();
  const syncCheckout = useSyncCheckout();
  const syncAttempted = useRef(false);

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    if (searchParams.get("success") === "true" && sessionId && !syncAttempted.current) {
      syncAttempted.current = true;
      syncCheckout.mutate(sessionId, {
        onSettled: () => {
          toast.success("Subscription activated!");
          window.history.replaceState({}, "", "/app/billing");
        },
      });
    } else if (searchParams.get("success") === "true" && !sessionId) {
      toast.success("Subscription activated!");
      window.history.replaceState({}, "", "/app/billing");
    }
  }, [searchParams, syncCheckout]);

  const tier: Tier =
    subscription && subscription.status === "active"
      ? (subscription.tier as Tier)
      : "free";
  const tierConfig = TIERS[tier];
  const isPaid = tier !== "free";

  const currentSpend = costData?.totals.totalCostMicrodollars ?? 0;
  const spendCap = tierConfig.spendCapMicrodollars;
  const spendPct = Math.min((currentSpend / spendCap) * 100, 100);

  if (isLoading) return <BillingSkeleton />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Billing
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Manage your subscription and monitor usage.
        </p>
      </div>

      {/* Current plan */}
      <div className="rounded-lg border border-border/30 bg-background p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <CreditCard className="h-4 w-4 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-foreground">
                  {tierConfig.label} Plan
                </p>
                <Badge variant={isPaid ? "default" : "secondary"}>
                  {isPaid ? "Active" : "Free"}
                </Badge>
              </div>
              {isPaid && subscription?.currentPeriodEnd && (
                <p className="text-xs text-muted-foreground">
                  {subscription.cancelAtPeriodEnd
                    ? "Cancels"
                    : "Renews"}{" "}
                  {new Date(subscription.currentPeriodEnd).toLocaleDateString(
                    "en-US",
                    { month: "long", day: "numeric", year: "numeric" },
                  )}
                </p>
              )}
            </div>
          </div>
          {isPaid && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => portal.mutate()}
              disabled={portal.isPending}
            >
              {portal.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ExternalLink className="h-3 w-3" />
              )}
              Manage Subscription
            </Button>
          )}
        </div>
      </div>

      {/* Usage meter */}
      <div className="rounded-lg border border-border/30 bg-background p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">
            Monthly Usage (30d)
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatMicrodollars(currentSpend)} /{" "}
            {formatMicrodollars(spendCap)}
          </p>
        </div>
        <Progress
          value={spendPct}
          indicatorClassName={
            spendPct >= 90
              ? "bg-red-500"
              : spendPct >= 70
                ? "bg-amber-500"
                : undefined
          }
        />
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
          <span>Budgets: {isPaid ? "Unlimited" : `${tierConfig.maxBudgets} max`}</span>
          <span>Data retention: {tierConfig.retentionDays} days</span>
        </div>
      </div>

      {/* Upgrade card (Free users only) */}
      {!isPaid && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <PricingCard
            tier="pro"
            onUpgrade={(priceId) => checkout.mutate(priceId)}
            isPending={checkout.isPending}
          />
          <div className="flex flex-col rounded-lg border border-border/30 bg-background p-5">
            <div className="mb-4">
              <p className="text-base font-semibold text-foreground">Enterprise</p>
              <p className="mt-1 text-sm text-muted-foreground">Custom pricing</p>
            </div>
            <ul className="mb-5 flex-1 space-y-2">
              {["Unlimited spend", "Unlimited budgets", "Custom retention", "Team members & roles", "SSO & SAML", "Dedicated support"].map((f) => (
                <li key={f} className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-primary" />
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="mailto:support@nullspend.com"
              className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Contact Us
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function PricingCard({
  tier,
  onUpgrade,
  isPending,
}: {
  tier: "pro";
  onUpgrade: (priceId: string) => void;
  isPending: boolean;
}) {
  const config = TIERS[tier];

  const features = [
    `${formatMicrodollars(config.spendCapMicrodollars)} spend cap`,
    "Unlimited budgets",
    `${config.retentionDays}-day data retention`,
    "Unlimited team members",
    "Priority support",
  ];

  return (
    <div className="flex flex-col rounded-lg border border-border/30 bg-background p-5">
      <div className="mb-4">
        <p className="text-base font-semibold text-foreground">
          {config.label}
        </p>
        <p className="mt-1 flex items-baseline gap-1">
          <span className="text-2xl font-bold tabular-nums text-foreground">
            ${config.price}
          </span>
          <span className="text-xs text-muted-foreground">/month</span>
        </p>
      </div>
      <ul className="mb-5 flex-1 space-y-2">
        {features.map((f) => (
          <li
            key={f}
            className="flex items-center gap-2 text-[13px] text-muted-foreground"
          >
            <Check className="h-3.5 w-3.5 text-primary" />
            {f}
          </li>
        ))}
      </ul>
      <Button
        onClick={() => {
          const priceId = process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID;
          if (!priceId) {
            toast.error(
              "STRIPE_PRO_PRICE_ID is not configured. Contact support.",
            );
            return;
          }
          onUpgrade(priceId);
        }}
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : null}
        Upgrade to {config.label}
      </Button>
    </div>
  );
}

function BillingSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-6 w-24 bg-secondary/50" />
        <Skeleton className="mt-2 h-4 w-48 bg-secondary/50" />
      </div>
      <Skeleton className="h-24 w-full rounded-lg bg-secondary/50" />
      <Skeleton className="h-24 w-full rounded-lg bg-secondary/50" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-lg bg-secondary/50" />
        <Skeleton className="h-64 w-full rounded-lg bg-secondary/50" />
      </div>
    </div>
  );
}
