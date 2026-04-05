import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { stripeConnections } from "@nullspend/db";
import { withRequestContext } from "@/lib/observability";

export const DELETE = withRequestContext(async (_request: Request) => {
  const { userId, orgId } = await resolveSessionContext();
  await assertOrgRole(userId, orgId, "admin");

  const db = getDb();
  const deleted = await db
    .delete(stripeConnections)
    .where(eq(stripeConnections.orgId, orgId))
    .returning({ id: stripeConnections.id });

  if (deleted.length === 0) {
    return NextResponse.json(
      { error: { code: "not_found", message: "No Stripe connection found.", details: null } },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: { deleted: true } });
});
