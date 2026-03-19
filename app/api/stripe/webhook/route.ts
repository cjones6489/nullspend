import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import Stripe from "stripe";

import { getStripe } from "@/lib/stripe/client";
import {
  getSubscriptionByStripeCustomerId,
  upsertSubscription,
} from "@/lib/stripe/subscription";
import { tierFromPriceId } from "@/lib/stripe/tiers";

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[NullSpend] STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: { code: "server_error", message: "Webhook secret not configured.", details: null } },
      { status: 500 },
    );
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: { code: "missing_signature", message: "Missing stripe-signature header.", details: null } },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[NullSpend] Webhook signature verification failed:", message);
    return NextResponse.json(
      { error: { code: "signature_invalid", message: "Webhook signature verification failed.", details: null } },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object, stripe);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object, stripe);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object);
        break;
      default:
        console.log(`[NullSpend] Unhandled webhook event: ${event.type}`);
    }
  } catch (err) {
    const isTransient =
      err instanceof Error &&
      /connect|timeout|ECONNREFUSED|ECONNRESET|503|too many connections/i.test(
        err.message,
      );
    console.error(
      `[NullSpend] ${isTransient ? "Transient" : "Permanent"} error processing webhook event ${event.id} (${event.type}):`,
      err,
    );
    Sentry.withScope((scope) => {
      scope.setTag("stripe.eventId", event.id);
      scope.setTag("stripe.eventType", event.type);
      scope.setTag("stripe.errorClass", isTransient ? "transient" : "permanent");
      Sentry.captureException(err);
    });
    if (isTransient) {
      // Return 500 so Stripe retries — the error may resolve on its own.
      return NextResponse.json(
        { error: { code: "webhook_processing_error", message: "Webhook processing failed (transient).", details: null } },
        { status: 500 },
      );
    }
    // Permanent error: return 200 to prevent Stripe from retrying endlessly.
    // The error is logged above for investigation.
    return NextResponse.json({ received: true, error: { code: "processing_failed", message: "Permanent webhook processing failure.", details: null } });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
) {
  const userId = session.metadata?.userId;
  const tier = session.metadata?.tier;
  if (!userId || !tier) {
    console.error(
      "[NullSpend] checkout.session.completed missing metadata:",
      session.id,
    );
    return;
  }

  const stripeCustomerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id;
  const stripeSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  if (!stripeCustomerId || !stripeSubscriptionId) {
    console.error(
      "[NullSpend] checkout.session.completed missing customer/subscription:",
      session.id,
    );
    return;
  }

  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;

  try {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    const item = sub.items.data[0];
    if (item?.current_period_start) {
      periodStart = new Date(item.current_period_start * 1000);
    }
    if (item?.current_period_end) {
      periodEnd = new Date(item.current_period_end * 1000);
    }
  } catch (err) {
    console.warn(
      "[NullSpend] checkout.session.completed: failed to retrieve subscription for period dates:",
      err,
    );
  }

  await upsertSubscription({
    userId,
    stripeCustomerId,
    stripeSubscriptionId,
    tier,
    status: "active",
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
  });

  console.log(
    `[NullSpend] Subscription created via checkout: userId=${userId}, tier=${tier}`,
  );
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
  stripe: Stripe,
) {
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const existing = await getSubscriptionByStripeCustomerId(stripeCustomerId);

  let userId: string;
  if (existing) {
    userId = existing.userId;
  } else {
    // Event ordering fallback: checkout.session.completed may not have arrived yet.
    // Look up userId from Stripe Customer metadata.
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    if (customer.deleted) {
      console.error(
        "[NullSpend] subscription.updated for deleted customer:",
        stripeCustomerId,
      );
      return;
    }
    const metaUserId = customer.metadata?.userId;
    if (!metaUserId) {
      console.error(
        "[NullSpend] subscription.updated: no userId in customer metadata:",
        stripeCustomerId,
      );
      return;
    }
    userId = metaUserId;
  }

  const item = subscription.items.data[0];
  if (!item) {
    console.error(
      "[NullSpend] subscription.updated: no items:",
      subscription.id,
    );
    return;
  }

  const tier = tierFromPriceId(item.price.id);
  if (!tier) {
    console.warn(
      `[NullSpend] subscription.updated: unrecognized price ${item.price.id}`,
    );
    return;
  }

  // In API version 2026-02-25.clover, period dates are on the item, not the subscription root.
  const periodStart = item.current_period_start
    ? new Date(item.current_period_start * 1000)
    : null;
  const periodEnd = item.current_period_end
    ? new Date(item.current_period_end * 1000)
    : null;

  await upsertSubscription({
    userId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    tier,
    status: subscription.status,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });

  console.log(
    `[NullSpend] Subscription updated: userId=${userId}, tier=${tier}, status=${subscription.status}`,
  );
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;

  const existing = await getSubscriptionByStripeCustomerId(stripeCustomerId);
  if (!existing) {
    console.warn(
      "[NullSpend] subscription.deleted: no row found for customer:",
      stripeCustomerId,
    );
    return;
  }

  await upsertSubscription({
    userId: existing.userId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    tier: existing.tier,
    status: "canceled",
    cancelAtPeriodEnd: false,
  });

  console.log(
    `[NullSpend] Subscription canceled: userId=${existing.userId}`,
  );
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const stripeCustomerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;
  if (!stripeCustomerId) return;

  const existing = await getSubscriptionByStripeCustomerId(stripeCustomerId);
  if (!existing) return;

  if (existing.status === "past_due") {
    await upsertSubscription({
      ...existing,
      status: "active",
    });
    console.log(
      `[NullSpend] Subscription reactivated after payment: userId=${existing.userId}`,
    );
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const stripeCustomerId =
    typeof invoice.customer === "string"
      ? invoice.customer
      : invoice.customer?.id;
  if (!stripeCustomerId) return;

  const existing = await getSubscriptionByStripeCustomerId(stripeCustomerId);
  if (!existing) return;

  await upsertSubscription({
    ...existing,
    status: "past_due",
  });

  console.log(
    `[NullSpend] Subscription past_due after payment failure: userId=${existing.userId}`,
  );
}
