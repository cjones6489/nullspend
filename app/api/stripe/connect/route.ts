import { NextResponse } from "next/server";
import Stripe from "stripe";
import { eq } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { STRIPE_API_VERSION } from "@/lib/stripe/client";
import { stripeConnections } from "@nullspend/db";
import { encryptStripeKey } from "@/lib/margins/encryption";
import { withRequestContext } from "@/lib/observability";
import { readJsonBody } from "@/lib/utils/http";

export const GET = withRequestContext(async (_request: Request) => {
  const { userId, orgId } = await resolveSessionContext();
  await assertOrgRole(userId, orgId, "viewer");

  const db = getDb();
  const [connection] = await db
    .select({
      id: stripeConnections.id,
      keyPrefix: stripeConnections.keyPrefix,
      status: stripeConnections.status,
      lastSyncAt: stripeConnections.lastSyncAt,
      lastError: stripeConnections.lastError,
      createdAt: stripeConnections.createdAt,
    })
    .from(stripeConnections)
    .where(eq(stripeConnections.orgId, orgId))
    .limit(1);

  if (!connection) {
    return NextResponse.json({ data: null });
  }

  return NextResponse.json({
    data: {
      id: connection.id,
      keyPrefix: connection.keyPrefix,
      status: connection.status,
      lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
      lastError: connection.lastError,
      createdAt: connection.createdAt.toISOString(),
    },
  });
});

export const POST = withRequestContext(async (request: Request) => {
  const { userId, orgId } = await resolveSessionContext();
  await assertOrgRole(userId, orgId, "admin");

  const body = (await readJsonBody(request)) as { stripeKey?: string };
  const rawKey = body.stripeKey?.trim();

  if (!rawKey) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "stripeKey is required.", details: null } },
      { status: 400 },
    );
  }

  // Validate restricted key prefix (allow sk_test_ in non-production only)
  const allowTestKeys = process.env.NODE_ENV !== "production";
  if (!rawKey.startsWith("rk_") && !(allowTestKeys && rawKey.startsWith("sk_test_"))) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Use a Stripe restricted key (rk_live_... or rk_test_...).", details: null } },
      { status: 400 },
    );
  }

  const db = getDb();

  // Check for existing connection
  const [existing] = await db
    .select({ id: stripeConnections.id })
    .from(stripeConnections)
    .where(eq(stripeConnections.orgId, orgId))
    .limit(1);

  if (existing) {
    return NextResponse.json(
      { error: { code: "conflict", message: "Stripe is already connected. Disconnect first.", details: null } },
      { status: 409 },
    );
  }

  // Test the key with a minimal API call
  const stripe = new Stripe(rawKey, { apiVersion: STRIPE_API_VERSION });
  try {
    await stripe.customers.list({ limit: 1 });
  } catch (err) {
    const msg = err instanceof Stripe.errors.StripeAuthenticationError
      ? "Invalid Stripe key — authentication failed."
      : "Stripe key validation failed — ensure the key has invoice and customer read permissions.";
    return NextResponse.json(
      { error: { code: "stripe_validation_failed", message: msg, details: null } },
      { status: 400 },
    );
  }

  // Encrypt and store
  const encryptedKey = encryptStripeKey(rawKey, orgId);
  const keyPrefix = rawKey.slice(0, 12) + "..." + rawKey.slice(-4);

  const rows = await db
    .insert(stripeConnections)
    .values({
      orgId,
      encryptedKey,
      keyPrefix,
      status: "active",
    })
    .onConflictDoNothing()
    .returning();

  // Race condition: another request inserted between our SELECT and INSERT
  if (rows.length === 0) {
    return NextResponse.json(
      { error: { code: "conflict", message: "Stripe is already connected. Disconnect first.", details: null } },
      { status: 409 },
    );
  }

  const connection = rows[0];
  return NextResponse.json(
    {
      data: {
        id: connection.id,
        keyPrefix: connection.keyPrefix,
        status: connection.status,
        createdAt: connection.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
});
