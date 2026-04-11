import { eq, and } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { orgMemberships } from "@nullspend/db";
import { ForbiddenError } from "@/lib/auth/errors";
import type { OrgRole } from "@/lib/validations/orgs";

const ROLE_LEVEL: Record<OrgRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export interface OrgMember {
  userId: string;
  orgId: string;
  role: OrgRole;
}

/**
 * Verify the user is a member of the org. Throws ForbiddenError if not.
 * Returns the membership record (userId, orgId, role).
 */
export async function assertOrgMember(
  userId: string,
  orgId: string,
): Promise<OrgMember> {
  const db = getDb();
  const [membership] = await db
    .select({ userId: orgMemberships.userId, orgId: orgMemberships.orgId, role: orgMemberships.role })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)))
    .limit(1);

  if (!membership) {
    throw new ForbiddenError("You are not a member of this organization.");
  }

  return membership as OrgMember;
}

/**
 * Verify the user has at least the specified role in the org.
 * Throws ForbiddenError if the user is not a member or has insufficient role.
 * Returns the membership record.
 */
export async function assertOrgRole(
  userId: string,
  orgId: string,
  minRole: OrgRole,
): Promise<OrgMember> {
  const member = await assertOrgMember(userId, orgId);

  if (!Object.hasOwn(ROLE_LEVEL, member.role) || ROLE_LEVEL[member.role] < ROLE_LEVEL[minRole]) {
    throw new ForbiddenError(
      `This action requires the ${minRole} role or higher.`,
    );
  }

  return member;
}
