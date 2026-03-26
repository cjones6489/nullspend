import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { resolveSessionContext, setActiveOrgCookie, invalidateMembershipCache } from "@/lib/auth/session";
import { assertOrgMember } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { apiKeys, orgMemberships } from "@nullspend/db";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { orgIdParamsSchema } from "@/lib/validations/orgs";
import { ForbiddenError } from "@/lib/auth/errors";
import { logAuditEvent } from "@/lib/audit/log";

type RouteContext = { params: Promise<{ orgId: string }> };

/**
 * POST /api/orgs/[orgId]/leave — leave an organization.
 * Any member except the owner. Revokes API keys and deletes membership.
 * Owner must transfer ownership before leaving.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { userId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId } = orgIdParamsSchema.parse(params);

    const membership = await assertOrgMember(userId, orgId);

    if (membership.role === "owner") {
      throw new ForbiddenError(
        "The owner cannot leave the organization. Transfer ownership first.",
      );
    }

    const db = getDb();

    // Revoke the user's API keys for this org + delete membership
    await db.transaction(async (tx) => {
      await tx
        .update(apiKeys)
        .set({ revokedAt: sql`NOW()` })
        .where(
          and(
            eq(apiKeys.orgId, orgId),
            eq(apiKeys.userId, userId),
            sql`${apiKeys.revokedAt} IS NULL`,
          ),
        );

      await tx
        .delete(orgMemberships)
        .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)));
    });

    invalidateMembershipCache(userId, orgId);

    // Switch active org cookie to personal org (resolveSessionContext will handle this on next request,
    // but let's be explicit by letting it fall through to the personal org path)
    // The simplest approach: clear the cookie so next request creates/finds the personal org
    await setActiveOrgCookie("", "viewer");

    logAuditEvent({ orgId, actorId: userId, action: "member.left", resourceType: "membership", resourceId: userId });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
