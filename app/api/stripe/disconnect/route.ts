import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { stripeConnections, customerRevenue, customerMappings, marginAlertsSent } from "@nullspend/db";
import { withRequestContext } from "@/lib/observability";

export const DELETE = withRequestContext(async (_request: Request) => {
  const { userId, orgId } = await resolveSessionContext();
  await assertOrgRole(userId, orgId, "admin");

  const db = getDb();

  // Cascade: remove connection + all revenue, mapping, and alert dedup data for this org
  // STRIPE-15: include margin_alerts_sent so reconnecting doesn't suppress legitimate alerts
  const deleted = await db.transaction(async (tx) => {
    await tx.delete(customerRevenue).where(eq(customerRevenue.orgId, orgId));
    await tx.delete(customerMappings).where(eq(customerMappings.orgId, orgId));
    await tx.delete(marginAlertsSent).where(eq(marginAlertsSent.orgId, orgId));
    return tx
      .delete(stripeConnections)
      .where(eq(stripeConnections.orgId, orgId))
      .returning({ id: stripeConnections.id });
  });

  if (deleted.length === 0) {
    return NextResponse.json(
      { error: { code: "not_found", message: "No Stripe connection found.", details: null } },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: { deleted: true } });
});
