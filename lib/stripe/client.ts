import Stripe from "stripe";

/** Pinned Stripe API version — single source of truth for the entire app. */
export const STRIPE_API_VERSION = "2026-02-25.clover" as Stripe.LatestApiVersion;

declare global {
  var __stripe: Stripe | undefined;
}

export function getStripe(): Stripe {
  if (!globalThis.__stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    globalThis.__stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  }
  return globalThis.__stripe;
}

export function getOrigin(request: Request): string {
  // Prefer explicit config over request headers to prevent host injection.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) return appUrl.replace(/\/+$/, "");

  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "localhost:3000";
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0] ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
