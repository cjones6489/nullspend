import { and, desc, eq } from "drizzle-orm";

import { serializeCostEvent } from "@/lib/cost-events/serialize-cost-event";
import { getDb } from "@/lib/db/client";
import { apiKeys, costEvents } from "@nullspend/db";

export async function getCostEventsByActionId(
  actionId: string,
  orgId: string,
) {
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
      customerId: costEvents.customerId,
      keyName: apiKeys.name,
      costBreakdown: costEvents.costBreakdown,
    })
    .from(costEvents)
    .leftJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(
      and(
        eq(costEvents.actionId, actionId),
        eq(costEvents.orgId, orgId),
      ),
    )
    .orderBy(desc(costEvents.createdAt));

  return rows.map(serializeCostEvent);
}
