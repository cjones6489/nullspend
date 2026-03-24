export const TIERS = {
  free: {
    label: "Free",
    spendCapMicrodollars: 5_000_000_000, // $5,000 (soft cap — warn, don't block)
    maxBudgets: 3,
    maxApiKeys: 10,
    maxWebhookEndpoints: 2,
    retentionDays: 30,
    price: 0,
  },
  pro: {
    label: "Pro",
    spendCapMicrodollars: 50_000_000_000, // $50,000
    maxBudgets: Infinity,
    maxApiKeys: Infinity,
    maxWebhookEndpoints: 25,
    retentionDays: 90,
    price: 49,
  },
  team: {
    label: "Team",
    spendCapMicrodollars: 250_000_000_000, // $250,000
    maxBudgets: Infinity,
    maxApiKeys: Infinity,
    maxWebhookEndpoints: 50,
    retentionDays: 365,
    price: 199,
  },
} as const;

export type Tier = keyof typeof TIERS;

export function getTierForUser(
  subscription: { tier: string; status: string } | null,
): Tier {
  if (!subscription) return "free";
  // Treat past_due as active — Stripe retries payments over days/weeks.
  // Cutting access immediately on a transient card failure is too harsh.
  if (subscription.status !== "active" && subscription.status !== "past_due")
    return "free";
  return subscription.tier as Tier;
}

export function tierFromPriceId(priceId: string): Tier | null {
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return "pro";
  if (priceId === process.env.STRIPE_TEAM_PRICE_ID) return "team";
  return null;
}

export function isValidPriceId(priceId: string): boolean {
  return tierFromPriceId(priceId) !== null;
}
