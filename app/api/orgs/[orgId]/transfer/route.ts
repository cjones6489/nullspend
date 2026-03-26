import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { resolveSessionContext, invalidateMembershipCache } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { orgMemberships } from "@nullspend/db";
import { handleRouteError, readJsonBody, readRouteParams } from "@/lib/utils/http";
import { orgIdParamsSchema } from "@/lib/validations/orgs";
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

    // Transfer inside a transaction with locked rows to prevent TOCTOU race.
    // SELECT FOR UPDATE locks the target row so it can't be removed mid-transaction.
    class TransferValidationError extends Error {
      constructor(public status: number, public code: string, msg: string) { super(msg); }
    }

    try {
      await db.transaction(async (tx) => {
        // Verify the target is still a member (locked to prevent concurrent removal)
        const rows = await tx.execute(
          sql`SELECT role FROM org_memberships WHERE org_id = ${orgId} AND user_id = ${newOwnerUserId} FOR UPDATE`,
        );

        if (rows.length === 0) {
          throw new TransferValidationError(404, "not_found", "Target user is not a member of this organization.");
        }

        const targetRole = (rows[0] as { role: string }).role;
        if (targetRole === "viewer") {
          throw new TransferValidationError(400, "validation_error", "Viewers cannot be promoted to owner.");
        }

        // Demote current owner → admin
        await tx
          .update(orgMemberships)
          .set({ role: "admin", updatedAt: sql`NOW()` })
          .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)));

        // Promote target → owner
        await tx
          .update(orgMemberships)
          .set({ role: "owner", updatedAt: sql`NOW()` })
          .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, newOwnerUserId)));
      });
    } catch (err) {
      if (err instanceof TransferValidationError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message, details: null } },
          { status: err.status },
        );
      }
      throw err;
    }

    invalidateMembershipCache(userId, orgId);
    invalidateMembershipCache(newOwnerUserId, orgId);

    logAuditEvent({ orgId, actorId: userId, action: "org.ownership_transferred", resourceType: "org", resourceId: orgId, metadata: { newOwnerUserId } });

    return NextResponse.json({ success: true, newOwnerUserId });
  } catch (error) {
    return handleRouteError(error);
  }
}
