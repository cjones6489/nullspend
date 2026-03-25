import { NextResponse } from "next/server";

import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import { getSubscriptionByOrgId } from "@/lib/stripe/subscription";
import { handleRouteError } from "@/lib/utils/http";

export async function GET() {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");
    const row = await getSubscriptionByOrgId(orgId);

    if (!row) {
      return NextResponse.json(null);
    }

    return NextResponse.json({
      id: row.id,
      tier: row.tier,
      status: row.status,
      currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
