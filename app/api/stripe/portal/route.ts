import { NextResponse } from "next/server";

import { resolveSessionContext } from "@/lib/auth/session";
import { getStripe, getOrigin } from "@/lib/stripe/client";
import { getSubscriptionByUserId } from "@/lib/stripe/subscription";
import { handleRouteError } from "@/lib/utils/http";

export async function POST(request: Request) {
  try {
    const { userId } = await resolveSessionContext();
    const existing = await getSubscriptionByUserId(userId);

    if (!existing?.stripeCustomerId) {
      return NextResponse.json(
        { error: { code: "no_subscription", message: "No active subscription to manage.", details: null } },
        { status: 400 },
      );
    }

    const stripe = getStripe();
    const origin = getOrigin(request);

    const session = await stripe.billingPortal.sessions.create({
      customer: existing.stripeCustomerId,
      return_url: `${origin}/app/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return handleRouteError(error);
  }
}
