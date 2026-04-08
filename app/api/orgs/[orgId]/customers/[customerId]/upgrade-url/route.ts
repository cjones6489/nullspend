import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgMember, assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { customerSettings } from "@nullspend/db";
import { handleRouteError, readJsonBody, readRouteParams } from "@/lib/utils/http";
import { setUpgradeUrlSchema } from "@/lib/validations/orgs";
import { nsIdInput } from "@/lib/ids/prefixed-id";
import { logAuditEvent } from "@/lib/audit/log";

// invalidateProxyCache is intentionally NOT imported — per-customer URL
// is looked up fresh on every denial (see E4 audit finding).

type RouteContext = { params: Promise<{ orgId: string; customerId: string }> };

// Customer ID regex mirrors packages/sdk/src/customer-id.ts so the dashboard
// rejects inputs that the SDK would refuse to send. Prevents data-orphaning
// where a dashboard-configured URL is never reachable because the SDK will
// never transmit that customer_id in the X-NullSpend-Customer header.
// (Edge-case audit E7.)
const CUSTOMER_ID_REGEX = /^[a-zA-Z0-9._:-]+$/;

const customerUpgradeUrlParamsSchema = z.object({
  // Accepts the prefixed external ID format (ns_org_<uuid>) that the
  // dashboard uses for all other org endpoints. (Edge-case audit E1.)
  orgId: nsIdInput("org"),
  customerId: z
    .string()
    .min(1)
    .max(256)
    .regex(
      CUSTOMER_ID_REGEX,
      "customerId must match the SDK format: alphanumerics plus . _ : -",
    ),
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

    // NO proxy cache invalidation needed here: per-customer upgrade URLs
    // are queried fresh on every denial via `lookupCustomerUpgradeUrl`
    // (cold-path Postgres, no auth cache coupling). Invalidating the
    // org's auth cache for a per-customer change would thrash every
    // cached API key with zero benefit. (Edge-case audit E4.)

    // Audit log: URL changes are security-sensitive (agents may auto-
    // follow the URL on denial). Track every write with actor + before/after.
    logAuditEvent({
      orgId,
      actorId: userId,
      action: "customer_upgrade_url.updated",
      resourceType: "customer_settings",
      resourceId: customerId,
      metadata: { upgradeUrl },
    });

    return NextResponse.json({ data: { customerId, upgradeUrl } });
  } catch (error) {
    return handleRouteError(error);
  }
}
