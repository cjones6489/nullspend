import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";

import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import { serializeCostEvent } from "@/lib/cost-events/serialize-cost-event";
import { getDb } from "@/lib/db/client";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { apiKeys, costEvents } from "@nullspend/db";

const MAX_SESSION_ID_LENGTH = 200;

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");
    const params = await readRouteParams(context.params);

    const sessionId = params.sessionId;
    if (!sessionId || sessionId.length === 0 || sessionId.length > MAX_SESSION_ID_LENGTH) {
      return NextResponse.json(
        { error: { code: "validation_error", message: "Invalid session ID.", details: null } },
        { status: 400 },
      );
    }

    const db = getDb();

    const rows = await db
      .select({
        id: costEvents.id,
        requestId: costEvents.requestId,
        apiKeyId: costEvents.apiKeyId,
        provider: costEvents.provider,
        model: costEvents.model,
        inputTokens: costEvents.inputTokens,
        outputTokens: costEvents.outputTokens,
        cachedInputTokens: costEvents.cachedInputTokens,
        reasoningTokens: costEvents.reasoningTokens,
        costMicrodollars: costEvents.costMicrodollars,
        durationMs: costEvents.durationMs,
        createdAt: costEvents.createdAt,
        traceId: costEvents.traceId,
        sessionId: costEvents.sessionId,
        source: costEvents.source,
        tags: costEvents.tags,
        keyName: apiKeys.name,
        costBreakdown: costEvents.costBreakdown,
      })
      .from(costEvents)
      .leftJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
      .where(
        and(
          eq(costEvents.orgId, orgId),
          eq(costEvents.sessionId, sessionId),
        ),
      )
      .orderBy(asc(costEvents.createdAt), asc(costEvents.id))
      .limit(200);

    // Compute aggregate stats
    let totalCostMicrodollars = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalDurationMs = 0;
    for (const row of rows) {
      totalCostMicrodollars += row.costMicrodollars;
      totalInputTokens += row.inputTokens;
      totalOutputTokens += row.outputTokens;
      totalDurationMs += row.durationMs ?? 0;
    }

    const firstEvent = rows[0];
    const lastEvent = rows[rows.length - 1];
    const startedAt = firstEvent ? firstEvent.createdAt.toISOString() : null;
    const endedAt = lastEvent ? lastEvent.createdAt.toISOString() : null;

    return NextResponse.json({
      sessionId,
      summary: {
        eventCount: rows.length,
        totalCostMicrodollars,
        totalInputTokens,
        totalOutputTokens,
        totalDurationMs,
        startedAt,
        endedAt,
      },
      events: rows.map(serializeCostEvent),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
