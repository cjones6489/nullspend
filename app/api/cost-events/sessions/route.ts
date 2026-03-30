import { NextResponse } from "next/server";
import { and, desc, eq, lt } from "drizzle-orm";

import { CURRENT_VERSION } from "@/lib/api-version";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { handleRouteError } from "@/lib/utils/http";
import { sessions } from "@nullspend/db";

const PAGE_SIZE = 25;

export async function GET(request: Request) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");

    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor");

    const db = getDb();

    const conditions = [eq(sessions.orgId, orgId)];

    if (cursor) {
      conditions.push(lt(sessions.lastEventAt, new Date(cursor)));
    }

    const rows = await db
      .select({
        sessionId: sessions.sessionId,
        eventCount: sessions.eventCount,
        totalCostMicrodollars: sessions.totalCostMicrodollars,
        firstEventAt: sessions.firstEventAt,
        lastEventAt: sessions.lastEventAt,
      })
      .from(sessions)
      .where(and(...conditions))
      .orderBy(desc(sessions.lastEventAt))
      .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && lastRow ? lastRow.lastEventAt.toISOString() : null;

    const response = NextResponse.json({
      data: pageRows.map((row) => ({
        sessionId: row.sessionId,
        eventCount: row.eventCount,
        totalCostMicrodollars: row.totalCostMicrodollars,
        firstEventAt: row.firstEventAt.toISOString(),
        lastEventAt: row.lastEventAt.toISOString(),
      })),
      cursor: nextCursor,
    });
    response.headers.set("NullSpend-Version", CURRENT_VERSION);
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
