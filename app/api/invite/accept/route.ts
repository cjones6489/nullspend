import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { resolveSessionContext, setActiveOrgCookie } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { orgInvitations, orgMemberships } from "@nullspend/db";
import { handleRouteError, readJsonBody } from "@/lib/utils/http";
import { acceptInviteSchema } from "@/lib/validations/orgs";
import { hashInviteToken } from "@/lib/auth/invitation";
import { withRequestContext } from "@/lib/observability";
import type { OrgRole } from "@/lib/validations/orgs";

/**
 * POST /api/invite/accept — accept an invitation via raw token.
 * Creates membership, marks invitation accepted, sets active org cookie.
 */
export const POST = withRequestContext(async (request: Request) => {
  const { userId } = await resolveSessionContext();
  const body = await readJsonBody(request);
  const { token } = acceptInviteSchema.parse(body);

  const tokenHash = hashInviteToken(token);

  const db = getDb();

  // Look up invitation by token hash
  const [invitation] = await db
    .select()
    .from(orgInvitations)
    .where(eq(orgInvitations.tokenHash, tokenHash))
    .limit(1);

  if (!invitation) {
    return NextResponse.json(
      { error: { code: "not_found", message: "Invalid invitation token.", details: null } },
      { status: 404 },
    );
  }

  if (invitation.status !== "pending") {
    return NextResponse.json(
      { error: { code: "conflict", message: `This invitation has already been ${invitation.status}.`, details: null } },
      { status: 409 },
    );
  }

  if (invitation.expiresAt < new Date()) {
    // Mark as expired
    await db
      .update(orgInvitations)
      .set({ status: "expired" })
      .where(eq(orgInvitations.id, invitation.id));

    return NextResponse.json(
      { error: { code: "expired", message: "This invitation has expired.", details: null } },
      { status: 410 },
    );
  }

  // Check if user is already a member
  const [existingMembership] = await db
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, invitation.orgId), eq(orgMemberships.userId, userId)))
    .limit(1);

  if (existingMembership) {
    return NextResponse.json(
      { error: { code: "conflict", message: "You are already a member of this organization.", details: null } },
      { status: 409 },
    );
  }

  // Create membership + mark invitation accepted in a transaction
  try {
    await db.transaction(async (tx) => {
      await tx.insert(orgMemberships).values({
        orgId: invitation.orgId,
        userId,
        role: invitation.role as OrgRole,
      });

      await tx
        .update(orgInvitations)
        .set({
          status: "accepted",
          acceptedBy: userId,
          acceptedAt: sql`NOW()`,
        })
        .where(eq(orgInvitations.id, invitation.id));
    });
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
      return NextResponse.json(
        { error: { code: "conflict", message: "You are already a member of this organization.", details: null } },
        { status: 409 },
      );
    }
    throw err;
  }

  // Switch active org to the newly joined org
  await setActiveOrgCookie(invitation.orgId, invitation.role as OrgRole);

  return NextResponse.json({
    orgId: invitation.orgId,
    role: invitation.role,
    redirectUrl: "/app",
  });
});
