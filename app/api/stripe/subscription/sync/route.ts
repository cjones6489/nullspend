import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getStripe } from "@/lib/stripe/client";
import { upsertSubscription } from "@/lib/stripe/subscription";
import { tierFromPriceId } from "@/lib/stripe/tiers";
import { handleRouteError, readJsonBody } from "@/lib/utils/http";
import { syncInputSchema } from "@/lib/validations/subscription";

export async function POST(request: Request) {
  try {
    // STRIPE-8: Require admin — subscription sync overwrites org billing state
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "admin");
    const body = await readJsonBody(request);
    const { sessionId } = syncInputSchema.parse(body);

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    if (session.metadata?.orgId !== orgId) {
      return NextResponse.json(
        { error: { code: "forbidden", message: "Session does not belong to this organization.", details: null } },
        { status: 403 },
      );
    }

    const subscription = session.subscription as Stripe.Subscription | null;
    if (!subscription) {
      return NextResponse.json(
        { error: { code: "not_found", message: "No subscription found on this session.", details: null } },
        { status: 400 },
      );
    }

    const stripeCustomerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id;

    if (!stripeCustomerId) {
      return NextResponse.json(
        { error: { code: "not_found", message: "No customer found on this session.", details: null } },
        { status: 400 },
      );
    }

    const item = subscription.items.data[0];
    const tier = item ? tierFromPriceId(item.price.id) : null;

    const periodStart = item?.current_period_start
      ? new Date(item.current_period_start * 1000)
      : null;
    const periodEnd = item?.current_period_end
      ? new Date(item.current_period_end * 1000)
      : null;

    const row = await upsertSubscription({
      orgId,
      userId,
      stripeCustomerId,
      stripeSubscriptionId: subscription.id,
      // STRIPE-9: Fail closed on unknown price IDs — never silently downgrade to free.
      // Metadata tier is a fallback for custom pricing. If neither resolves, reject.
      tier: tier ?? session.metadata?.tier ?? (() => {
        throw new Error(`Unknown Stripe price ID: ${item?.price?.id ?? "none"}. Cannot determine tier.`);
      })(),
      status: subscription.status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });

    return NextResponse.json({ data: {
      id: row.id,
      tier: row.tier,
      status: row.status,
      currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      createdAt: row.createdAt.toISOString(),
    } });
  } catch (error) {
    return handleRouteError(error);
  }
}
