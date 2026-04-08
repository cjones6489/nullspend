import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { customerMappings } from "@nullspend/db";
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
 * PATCH /api/orgs/[orgId]/customers/[customerId]/upgrade-url
 *
 * Sets or clears the per-customer upgrade URL stored at
 * `customer_mappings.upgrade_url`. Takes priority over the org-level
 * default in `customer_budget_exceeded` denial responses.
 *
 * The `customerId` URL segment is the `tag_value` (the customer ID
 * users send in the X-NullSpend-Customer header), not the row UUID.
 *
 * Pass `{ upgradeUrl: null }` to clear. Returns 404 if no mapping
 * exists for the (orgId, customerId) pair — create the mapping first
 * via the customer mapping flow.
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

    // Update by (orgId, tagValue) — there may be multiple rows if the
    // same customer is mapped under multiple tag keys, but the unique
    // index on (orgId, tagKey, tagValue) means any single tag_key+tag_value
    // pair maps to one row. We update all rows matching the customer to
    // keep behavior consistent across tag_key variations.
    const rows = await db
      .update(customerMappings)
      .set({ upgradeUrl })
      .where(and(eq(customerMappings.orgId, orgId), eq(customerMappings.tagValue, customerId)))
      .returning({ id: customerMappings.id });

    if (rows.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: "not_found",
            message: "No customer mapping found for this customer ID. Map the customer first via the customer mappings UI.",
            details: null,
          },
        },
        { status: 404 },
      );
    }

    invalidateProxyCache({ action: "auth_only", ownerId: orgId }).catch((err) =>
      console.error("[customers/upgrade-url] Proxy cache invalidation failed:", err),
    );

    return NextResponse.json({ data: { customerId, upgradeUrl } });
  } catch (error) {
    return handleRouteError(error);
  }
}
