import { NextResponse } from "next/server";

import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/auth/supabase";
import { getStripe, getOrigin } from "@/lib/stripe/client";
import { getSubscriptionByOrgId } from "@/lib/stripe/subscription";
import { isValidPriceId, tierFromPriceId } from "@/lib/stripe/tiers";
import { handleRouteError, readJsonBody } from "@/lib/utils/http";
import { checkoutInputSchema } from "@/lib/validations/subscription";

export async function POST(request: Request) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "owner");
    const body = await readJsonBody(request);
    const input = checkoutInputSchema.parse(body);

    if (!isValidPriceId(input.priceId)) {
      return NextResponse.json(
        { error: { code: "invalid_input", message: "Invalid price ID.", details: null } },
        { status: 400 },
      );
    }

    const tier = tierFromPriceId(input.priceId)!;

    const existing = await getSubscriptionByOrgId(orgId);
    // STRIPE-10: Block checkout for active AND past_due subscriptions.
    // past_due orgs should resolve billing via the portal, not create a second subscription.
    if (existing && (existing.status === "active" || existing.status === "past_due")) {
      return NextResponse.json(
        {
          error: {
            code: "subscription_exists",
            message:
              "This organization already has an active subscription. Use the Manage Subscription page to change plans.",
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
        metadata: { orgId },
      });
      stripeCustomerId = customer.id;
    }

    const origin = getOrigin(request);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      metadata: { orgId, tier },
      subscription_data: {
        metadata: { orgId, tier },
      },
      success_url: `${origin}/app/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/app/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return handleRouteError(error);
  }
}
