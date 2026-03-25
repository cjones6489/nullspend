import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { apiKeys, orgMemberships } from "@nullspend/db";
import { handleRouteError, readJsonBody, readRouteParams } from "@/lib/utils/http";
import { orgIdParamsSchema, changeRoleSchema, memberRecordSchema } from "@/lib/validations/orgs";
import { ForbiddenError } from "@/lib/auth/errors";

type RouteContext = { params: Promise<{ orgId: string; userId: string }> };

/**
 * PATCH /api/orgs/[orgId]/members/[userId] — change a member's role.
 * Requires admin+ role. Cannot change own role. Cannot change the owner's role.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId } = orgIdParamsSchema.parse({ orgId: params.orgId });
    const targetUserId = params.userId;

    const requester = await assertOrgRole(session.userId, orgId, "admin");

    if (targetUserId === session.userId) {
      throw new ForbiddenError("You cannot change your own role.");
    }

    const body = await readJsonBody(request);
    const input = changeRoleSchema.parse(body);

    const db = getDb();

    // Find the target membership
    const [target] = await db
      .select({ role: orgMemberships.role })
      .from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, targetUserId)))
      .limit(1);

    if (!target) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Member not found.", details: null } },
        { status: 404 },
      );
    }

    if (target.role === "owner") {
      throw new ForbiddenError("The owner's role cannot be changed. Transfer ownership instead.");
    }

    // Admins can only manage members and viewers, not other admins
    if (requester.role === "admin" && target.role === "admin") {
      throw new ForbiddenError("Admins cannot change the role of other admins.");
    }

    const [updated] = await db
      .update(orgMemberships)
      .set({ role: input.role, updatedAt: sql`NOW()` })
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, targetUserId)))
      .returning();

    return NextResponse.json({
      data: memberRecordSchema.parse({
        userId: updated.userId,
        role: updated.role,
        createdAt: updated.createdAt.toISOString(),
      }),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * DELETE /api/orgs/[orgId]/members/[userId] — remove a member.
 * Requires admin+ role. Cannot remove the owner. Cannot remove yourself.
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const session = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId } = orgIdParamsSchema.parse({ orgId: params.orgId });
    const targetUserId = params.userId;

    const requester = await assertOrgRole(session.userId, orgId, "admin");

    if (targetUserId === session.userId) {
      throw new ForbiddenError("You cannot remove yourself. Leave the organization instead.");
    }

    const db = getDb();

    const [target] = await db
      .select({ role: orgMemberships.role })
      .from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, targetUserId)))
      .limit(1);

    if (!target) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Member not found.", details: null } },
        { status: 404 },
      );
    }

    if (target.role === "owner") {
      throw new ForbiddenError("The owner cannot be removed. Transfer ownership first.");
    }

    // Admins can only remove members and viewers, not other admins
    if (requester.role === "admin" && target.role === "admin") {
      throw new ForbiddenError("Admins cannot remove other admins.");
    }

    // Revoke the removed user's API keys for this org + delete membership
    await db.transaction(async (tx) => {
      await tx
        .update(apiKeys)
        .set({ revokedAt: sql`NOW()` })
        .where(
          and(
            eq(apiKeys.orgId, orgId),
            eq(apiKeys.userId, targetUserId),
            sql`${apiKeys.revokedAt} IS NULL`,
          ),
        );

      await tx
        .delete(orgMemberships)
        .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, targetUserId)));
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
