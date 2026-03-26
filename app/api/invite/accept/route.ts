import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { resolveSessionContext, setActiveOrgCookie, invalidateMembershipCache } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { orgInvitations, orgMemberships } from "@nullspend/db";
import { readJsonBody } from "@/lib/utils/http";
import { acceptInviteSchema } from "@/lib/validations/orgs";
import { hashInviteToken } from "@/lib/auth/invitation";
import { checkInviteRateLimit } from "@/lib/auth/invite-rate-limit";
import { withRequestContext } from "@/lib/observability";
import type { OrgRole } from "@/lib/validations/orgs";
import { logAuditEvent } from "@/lib/audit/log";

/**
 * POST /api/invite/accept — accept an invitation via raw token.
 * Rate limited: 10 attempts per minute per IP.
 * Creates membership, marks invitation accepted, sets active org cookie.
 */
export const POST = withRequestContext(async (request: Request) => {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");
  const rateCheck = checkInviteRateLimit(ip);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many attempts. Try again later.", details: null } },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfterSeconds ?? 60) } },
    );
  }

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

  invalidateMembershipCache(userId, invitation.orgId);

  // Switch active org to the newly joined org
  await setActiveOrgCookie(invitation.orgId, invitation.role as OrgRole);

  logAuditEvent({ orgId: invitation.orgId, actorId: userId, action: "invitation.accepted", resourceType: "invitation", resourceId: invitation.id });

  return NextResponse.json({
    orgId: invitation.orgId,
    role: invitation.role,
    redirectUrl: "/app",
  });
});
