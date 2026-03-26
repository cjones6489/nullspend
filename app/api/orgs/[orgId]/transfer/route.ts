import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { resolveSessionContext, invalidateMembershipCache } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { orgMemberships } from "@nullspend/db";
import { handleRouteError, readJsonBody, readRouteParams } from "@/lib/utils/http";
import { orgIdParamsSchema } from "@/lib/validations/orgs";
import { ForbiddenError } from "@/lib/auth/errors";
import { logAuditEvent } from "@/lib/audit/log";

const transferSchema = z.object({
  newOwnerUserId: z.string().min(1, "New owner user ID is required."),
});

type RouteContext = { params: Promise<{ orgId: string }> };

/**
 * POST /api/orgs/[orgId]/transfer — transfer ownership to another member.
 * Owner only. In a transaction: demote current owner to admin, promote target to owner.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { userId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId } = orgIdParamsSchema.parse(params);

    await assertOrgRole(userId, orgId, "owner");

    const body = await readJsonBody(request);
    const { newOwnerUserId } = transferSchema.parse(body);

    if (newOwnerUserId === userId) {
      return NextResponse.json(
        { error: { code: "validation_error", message: "You are already the owner.", details: null } },
        { status: 400 },
      );
    }

    const db = getDb();

    // Verify the target user is a member of this org
    const [target] = await db
      .select({ role: orgMemberships.role })
      .from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, newOwnerUserId)))
      .limit(1);

    if (!target) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Target user is not a member of this organization.", details: null } },
        { status: 404 },
      );
    }

    // Transfer: demote current owner → admin, promote target → owner
    await db.transaction(async (tx) => {
      await tx
        .update(orgMemberships)
        .set({ role: "admin", updatedAt: sql`NOW()` })
        .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)));

      await tx
        .update(orgMemberships)
        .set({ role: "owner", updatedAt: sql`NOW()` })
        .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, newOwnerUserId)));
    });

    invalidateMembershipCache(userId, orgId);
    invalidateMembershipCache(newOwnerUserId, orgId);

    logAuditEvent({ orgId, actorId: userId, action: "org.ownership_transferred", resourceType: "org", resourceId: orgId, metadata: { newOwnerUserId } });

    return NextResponse.json({ success: true, newOwnerUserId });
  } catch (error) {
    return handleRouteError(error);
  }
}
