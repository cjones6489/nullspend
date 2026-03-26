import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { orgInvitations } from "@nullspend/db";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { orgIdParamsSchema } from "@/lib/validations/orgs";
import { logAuditEvent } from "@/lib/audit/log";

type RouteContext = { params: Promise<{ orgId: string; id: string }> };

/**
 * DELETE /api/orgs/[orgId]/invitations/[id] — revoke a pending invitation.
 * Requires admin+ role.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { userId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId } = orgIdParamsSchema.parse({ orgId: params.orgId });
    const invitationId = params.id;

    await assertOrgRole(userId, orgId, "admin");

    const db = getDb();

    const [invitation] = await db
      .select({ status: orgInvitations.status })
      .from(orgInvitations)
      .where(and(eq(orgInvitations.id, invitationId), eq(orgInvitations.orgId, orgId)))
      .limit(1);

    if (!invitation) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Invitation not found.", details: null } },
        { status: 404 },
      );
    }

    if (invitation.status !== "pending") {
      return NextResponse.json(
        { error: { code: "conflict", message: `Cannot revoke an invitation with status "${invitation.status}".`, details: null } },
        { status: 409 },
      );
    }

    await db
      .update(orgInvitations)
      .set({ status: "revoked", revokedAt: sql`NOW()` })
      .where(eq(orgInvitations.id, invitationId));

    logAuditEvent({ orgId, actorId: userId, action: "invitation.revoked", resourceType: "invitation", resourceId: invitationId });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
