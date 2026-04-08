import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { customerSettings } from "@nullspend/db";
import { handleRouteError, readJsonBody, readRouteParams } from "@/lib/utils/http";
import { setUpgradeUrlSchema } from "@/lib/validations/orgs";
import { invalidateProxyCache } from "@/lib/proxy-invalidate";
import { z } from "zod";

type RouteContext = { params: Promise<{ orgId: string; customerId: string }> };

const customerUpgradeUrlParamsSchema = z.object({
  orgId: z.string().uuid(),
  customerId: z.string().min(1).max(256),
});

/**
 * GET /api/orgs/[orgId]/customers/[customerId]/upgrade-url
 *
 * Returns the per-customer upgrade URL from `customer_settings.upgrade_url`.
 * Returns `{ data: { upgradeUrl: null } }` when unset (no row OR row with
 * null upgrade_url). Any org member can read.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { userId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId, customerId } = customerUpgradeUrlParamsSchema.parse(params);

    // Read-only: any member can see the config (owner check is only on writes)
    const { assertOrgMember } = await import("@/lib/auth/org-authorization");
    await assertOrgMember(userId, orgId);

    const db = getDb();
    const [row] = await db
      .select({ upgradeUrl: customerSettings.upgradeUrl })
      .from(customerSettings)
      .where(and(eq(customerSettings.orgId, orgId), eq(customerSettings.customerId, customerId)))
      .limit(1);

    return NextResponse.json({
      data: { customerId, upgradeUrl: row?.upgradeUrl ?? null },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * PATCH /api/orgs/[orgId]/customers/[customerId]/upgrade-url
 *
 * Sets or clears the per-customer upgrade URL stored at
 * `customer_settings.upgrade_url`. Takes priority over the org-level
 * default in `customer_budget_exceeded` denial responses.
 *
 * The `customerId` URL segment is the value a client sends via the
 * X-NullSpend-Customer header (matches customer budget entity_id).
 *
 * Upsert semantics: if no row exists for (orgId, customerId), one is
 * created. No prerequisite of a customer_mappings row or Stripe setup.
 * Pass `{ upgradeUrl: null }` to clear (sets the column to null; the
 * row is left in place for future edits).
 *
 * Owner role required.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { userId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId, customerId } = customerUpgradeUrlParamsSchema.parse(params);

    await assertOrgRole(userId, orgId, "owner");

    const body = await readJsonBody(request);
    const { upgradeUrl } = setUpgradeUrlSchema.parse(body);

    const db = getDb();

    // Upsert on (org_id, customer_id) — independent of Stripe mapping.
    await db
      .insert(customerSettings)
      .values({
        orgId,
        customerId,
        upgradeUrl,
      })
      .onConflictDoUpdate({
        target: [customerSettings.orgId, customerSettings.customerId],
        set: {
          upgradeUrl,
          updatedAt: sql`NOW()`,
        },
      });

    // Fire-and-forget cache invalidation. Per-customer URL resolution
    // is NOT cached on auth identity — the proxy queries customer_settings
    // fresh on each denial — so this call is a no-op for per-customer
    // changes, but kept for symmetry with org-level edits and to surface
    // any other downstream cache that might exist later.
    invalidateProxyCache({ action: "auth_only", ownerId: orgId }).catch((err) =>
      console.error("[customers/upgrade-url] Proxy cache invalidation failed:", err),
    );

    return NextResponse.json({ data: { customerId, upgradeUrl } });
  } catch (error) {
    return handleRouteError(error);
  }
}
