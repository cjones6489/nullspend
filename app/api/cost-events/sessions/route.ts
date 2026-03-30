import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { CURRENT_VERSION } from "@/lib/api-version";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { handleRouteError } from "@/lib/utils/http";
import { costEvents } from "@nullspend/db";

const PAGE_SIZE = 25;

export async function GET(request: Request) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");

    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");

    const db = getDb();

    const conditions = [
      eq(costEvents.orgId, orgId),
      isNotNull(costEvents.sessionId),
    ];

    // Cursor-based pagination: fetch sessions with lastEventAt < cursor
    if (cursor) {
      conditions.push(sql`${costEvents.createdAt} < ${cursor}::timestamptz`);
    }

    const rows = await db
      .select({
        sessionId: costEvents.sessionId,
        eventCount: sql<number>`count(*)::int`,
        totalCostMicrodollars: sql<number>`sum(${costEvents.costMicrodollars})::int`,
        firstEventAt: sql<string>`min(${costEvents.createdAt})::text`,
        lastEventAt: sql<string>`max(${costEvents.createdAt})::text`,
      })
      .from(costEvents)
      .where(and(...conditions))
      .groupBy(costEvents.sessionId)
      .orderBy(desc(sql`max(${costEvents.createdAt})`))
      .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? lastRow.lastEventAt : null;

    const response = NextResponse.json({
      data: pageRows.map((row) => ({
        sessionId: row.sessionId,
        eventCount: row.eventCount,
        totalCostMicrodollars: row.totalCostMicrodollars,
        firstEventAt: row.firstEventAt,
        lastEventAt: row.lastEventAt,
      })),
      cursor: nextCursor,
    });
    response.headers.set("NullSpend-Version", CURRENT_VERSION);
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
