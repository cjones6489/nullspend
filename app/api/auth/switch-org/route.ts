import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveSessionContext, setActiveOrgCookie } from "@/lib/auth/session";
import { assertOrgMember } from "@/lib/auth/org-authorization";
import { handleRouteError, readJsonBody } from "@/lib/utils/http";
import { withRequestContext } from "@/lib/observability";
import type { OrgRole } from "@/lib/validations/orgs";

const switchOrgSchema = z.object({
  orgId: z.string().uuid("Invalid organization ID."),
});

/**
 * POST /api/auth/switch-org — switch the active organization.
 * Validates membership, sets the ns-active-org cookie, returns new session info.
 */
export const POST = withRequestContext(async (request: Request) => {
  const { userId } = await resolveSessionContext();
  const body = await readJsonBody(request);
  const { orgId } = switchOrgSchema.parse(body);

  const membership = await assertOrgMember(userId, orgId);

  await setActiveOrgCookie(orgId, membership.role as OrgRole);

  return NextResponse.json({
    userId,
    orgId,
    role: membership.role,
  });
});
