import { and, desc, eq, isNull } from "drizzle-orm";

import { serializeCostEvent } from "@/lib/cost-events/serialize-cost-event";
import { getDb } from "@/lib/db/client";
import { apiKeys, costEvents } from "@nullspend/db";

export async function getCostEventsByActionId(
  actionId: string,
  userId: string,
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
      source: costEvents.source,
      keyName: apiKeys.name,
    })
    .from(costEvents)
    .innerJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(
      and(
        eq(costEvents.actionId, actionId),
        eq(apiKeys.userId, userId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .orderBy(desc(costEvents.createdAt));

  return rows.map(serializeCostEvent);
}
