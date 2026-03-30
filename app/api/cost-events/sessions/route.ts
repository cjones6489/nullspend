import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { CURRENT_VERSION } from "@/lib/api-version";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { handleRouteError } from "@/lib/utils/http";
import { costEvents } from "@nullspend/db";

export async function GET(_request: Request) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");

    const db = getDb();

    // Aggregate sessions: distinct sessionId with stats
    const rows = await db
      .select({
        sessionId: costEvents.sessionId,
        eventCount: sql<number>`count(*)::int`,
        totalCostMicrodollars: sql<number>`sum(${costEvents.costMicrodollars})::int`,
        firstEventAt: sql<string>`min(${costEvents.createdAt})::text`,
        lastEventAt: sql<string>`max(${costEvents.createdAt})::text`,
      })
      .from(costEvents)
      .where(
        and(
          eq(costEvents.orgId, orgId),
          isNotNull(costEvents.sessionId),
        ),
      )
      .groupBy(costEvents.sessionId)
      .orderBy(desc(sql`max(${costEvents.createdAt})`))
      .limit(100);

    const response = NextResponse.json({
      data: rows.map((row) => ({
        sessionId: row.sessionId,
        eventCount: row.eventCount,
        totalCostMicrodollars: row.totalCostMicrodollars,
        firstEventAt: row.firstEventAt,
        lastEventAt: row.lastEventAt,
      })),
    });
    response.headers.set("NullSpend-Version", CURRENT_VERSION);
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
