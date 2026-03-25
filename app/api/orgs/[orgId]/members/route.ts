import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgMember } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { orgMemberships } from "@nullspend/db";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { orgIdParamsSchema, memberRecordSchema } from "@/lib/validations/orgs";

type RouteContext = { params: Promise<{ orgId: string }> };

/**
 * GET /api/orgs/[orgId]/members — list org members with roles.
 * Any member can view the member list.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { userId } = await resolveSessionContext();
    const params = await readRouteParams(context.params);
    const { orgId } = orgIdParamsSchema.parse(params);

    await assertOrgMember(userId, orgId);

    const db = getDb();
    const rows = await db
      .select({
        userId: orgMemberships.userId,
        role: orgMemberships.role,
        createdAt: orgMemberships.createdAt,
      })
      .from(orgMemberships)
      .where(eq(orgMemberships.orgId, orgId))
      .orderBy(asc(orgMemberships.createdAt));

    const data = rows.map((row) =>
      memberRecordSchema.parse({
        userId: row.userId,
        role: row.role,
        createdAt: row.createdAt.toISOString(),
      }),
    );

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
