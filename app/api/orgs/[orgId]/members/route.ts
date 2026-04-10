import { NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";

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

    // Resolve emails from auth.users for display. Best-effort — if the
    // query fails (e.g., auth schema not accessible), fall back to null.
    const userIds = rows.map((r) => r.userId);
    let emailMap = new Map<string, string>();
    if (userIds.length > 0) {
      try {
        const inClause = sql.join(userIds.map((id) => sql`${id}`), sql`, `);
        const emailRows = await db.execute(sql`
          SELECT id::text, email FROM auth.users WHERE id IN (${inClause})
        `) as unknown as Array<{ id: string; email: string }>;
        for (const row of emailRows) {
          emailMap.set(row.id, row.email);
        }
      } catch {
        // auth.users not accessible — emails will be null
      }
    }

    const data = rows.map((row) =>
      memberRecordSchema.parse({
        userId: row.userId,
        email: emailMap.get(row.userId) ?? null,
        role: row.role,
        createdAt: row.createdAt.toISOString(),
      }),
    );

    return NextResponse.json({ data });
  } catch (error) {
    return handleRouteError(error);
  }
}
