import { NextResponse } from "next/server";
import { and, eq, sql, count } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { orgInvitations, orgMemberships } from "@nullspend/db";
import { handleRouteError, readJsonBody, readRouteParams } from "@/lib/utils/http";
import {
  orgIdParamsSchema,
  inviteMemberSchema,
  invitationRecordSchema,
  SEAT_COUNTED_ROLES,
} from "@/lib/validations/orgs";
import { generateInviteToken, hashInviteToken, extractTokenPrefix } from "@/lib/auth/invitation";
import { resolveOrgTier, assertCountBelowLimit } from "@/lib/stripe/feature-gate";
import { logAuditEvent } from "@/lib/audit/log";

type RouteContext = { params: Promise<{ orgId: string }> };

const INVITE_EXPIRY_DAYS = 7;

/**
 * GET /api/orgs/[orgId]/invitations — list pending invitations.
 * Requires admin+ role.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { userId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId } = orgIdParamsSchema.parse(params);

    await assertOrgRole(userId, orgId, "admin");

    const db = getDb();
    const rows = await db
      .select()
      .from(orgInvitations)
      .where(and(
        eq(orgInvitations.orgId, orgId),
        eq(orgInvitations.status, "pending"),
        sql`${orgInvitations.expiresAt} > NOW()`,
      ));

    const data = rows.map((row) =>
      invitationRecordSchema.parse({
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        invitedBy: row.invitedBy,
        tokenPrefix: row.tokenPrefix,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      }),
    );

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/orgs/[orgId]/invitations — create an invitation.
 * Requires admin+ role.
 * Enforces maxTeamMembers (viewer invites exempt).
 * Prevents duplicate pending invitations to the same email.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { userId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId } = orgIdParamsSchema.parse(params);

    await assertOrgRole(userId, orgId, "admin");

    const body = await readJsonBody(request);
    const input = inviteMemberSchema.parse(body);

    const db = getDb();

    // Enforce seat limit for non-viewer roles
    if ((SEAT_COUNTED_ROLES as readonly string[]).includes(input.role)) {
      const tierInfo = await resolveOrgTier(orgId);

      // Count current seat-counted members + pending seat-counted invitations
      const [{ value: memberCount }] = await db
        .select({ value: count() })
        .from(orgMemberships)
        .where(
          and(
            eq(orgMemberships.orgId, orgId),
            sql`${orgMemberships.role} IN ('owner', 'admin', 'member')`,
          ),
        );

      const [{ value: pendingInviteCount }] = await db
        .select({ value: count() })
        .from(orgInvitations)
        .where(
          and(
            eq(orgInvitations.orgId, orgId),
            eq(orgInvitations.status, "pending"),
            sql`${orgInvitations.role} IN ('owner', 'admin', 'member')`,
          ),
        );

      assertCountBelowLimit(
        tierInfo,
        "maxTeamMembers",
        memberCount + pendingInviteCount,
        "team members",
      );
    }

    // Generate token
    const rawToken = generateInviteToken();
    const tokenHash = hashInviteToken(rawToken);
    const tokenPrefix = extractTokenPrefix(rawToken);
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    let invitation;
    try {
      [invitation] = await db
        .insert(orgInvitations)
        .values({
          orgId,
          email: input.email.toLowerCase(),
          role: input.role,
          invitedBy: userId,
          tokenHash,
          tokenPrefix,
          expiresAt,
        })
        .returning();
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
        return NextResponse.json(
          { error: { code: "conflict", message: "A pending invitation already exists for this email.", details: null } },
          { status: 409 },
        );
      }
      throw err;
    }

    logAuditEvent({ orgId, actorId: userId, action: "invitation.created", resourceType: "invitation", resourceId: invitation.id, metadata: { email: invitation.email, role: invitation.role } });

    return NextResponse.json(
      { data: {
        ...invitationRecordSchema.parse({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          invitedBy: invitation.invitedBy,
          tokenPrefix: invitation.tokenPrefix,
          expiresAt: invitation.expiresAt.toISOString(),
          createdAt: invitation.createdAt.toISOString(),
        }),
        // Include raw token ONLY in the create response (never stored, never returned again)
        token: rawToken,
      } },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
