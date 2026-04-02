import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import { serializeCostEvent } from "@/lib/cost-events/serialize-cost-event";
import { getDb } from "@/lib/db/client";
import { fromExternalIdOfType } from "@/lib/ids/prefixed-id";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { costEventRecordSchema } from "@/lib/validations/cost-events";
import { apiKeys, costEvents } from "@nullspend/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");
    const params = await readRouteParams(context.params);

    // Accept raw UUID or ns_evt_ prefixed ID
    let id: string;
    if (params.id.startsWith("ns_evt_")) {
      id = fromExternalIdOfType("evt", params.id);
    } else if (UUID_RE.test(params.id)) {
      id = params.id;
    } else {
      return NextResponse.json(
        { error: { code: "validation_error", message: "Invalid cost event ID.", details: null } },
        { status: 400 },
      );
    }

    const db = getDb();

    const [row] = await db
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
        budgetStatus: costEvents.budgetStatus,
        stopReason: costEvents.stopReason,
        estimatedCostMicrodollars: costEvents.estimatedCostMicrodollars,
        costBreakdown: costEvents.costBreakdown,
      })
      .from(costEvents)
      .leftJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
      .where(
        and(
          eq(costEvents.id, id),
          eq(costEvents.orgId, orgId),
        ),
      )
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Cost event not found.", details: null } },
        { status: 404 },
      );
    }

    return NextResponse.json({
      data: costEventRecordSchema.parse(serializeCostEvent(row)),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
