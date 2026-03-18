import { NextResponse } from "next/server";

import { resolveSessionUserId } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { getStripe, getOrigin } from "@/lib/stripe/client";
import { getSubscriptionByUserId } from "@/lib/stripe/subscription";
import { isValidPriceId, tierFromPriceId } from "@/lib/stripe/tiers";
import { handleRouteError, readJsonBody } from "@/lib/utils/http";
import { checkoutInputSchema } from "@/lib/validations/subscription";

export async function POST(request: Request) {
  try {
    const userId = await resolveSessionUserId();
    const body = await readJsonBody(request);
    const input = checkoutInputSchema.parse(body);

    if (!isValidPriceId(input.priceId)) {
      return NextResponse.json(
        { error: { code: "invalid_input", message: "Invalid price ID.", details: null } },
        { status: 400 },
      );
    }

    const tier = tierFromPriceId(input.priceId)!;

    const existing = await getSubscriptionByUserId(userId);
    if (existing && existing.status === "active") {
      return NextResponse.json(
        {
          error: {
            code: "subscription_exists",
            message:
              "You already have an active subscription. Use the Manage Subscription page to change plans.",
            details: null,
          },
        },
        { status: 400 },
      );
    }

    const stripe = getStripe();
    let stripeCustomerId: string;

    if (existing?.stripeCustomerId) {
      stripeCustomerId = existing.stripeCustomerId;
    } else {
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const customer = await stripe.customers.create({
        email: user?.email ?? undefined,
        metadata: { userId },
      });
      stripeCustomerId = customer.id;
    }

    const origin = getOrigin(request);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      metadata: { userId, tier },
      success_url: `${origin}/app/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/app/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return handleRouteError(error);
  }
}
