import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";

import { serializeCostEvent } from "@/lib/cost-events/serialize-cost-event";
import { getDb } from "@/lib/db/client";
import { apiKeys, costEvents, type CostEventSource } from "@nullspend/db";

interface ListCostEventsOptions {
  userId: string;
  limit: number;
  cursor?: { createdAt: string; id: string };
  requestId?: string;
  apiKeyId?: string;
  model?: string;
  provider?: string;
  source?: CostEventSource;
  traceId?: string;
  tags?: Record<string, string>;
}

export async function listCostEvents(options: ListCostEventsOptions) {
  const db = getDb();
  const conditions = [
    eq(apiKeys.userId, options.userId),
    isNull(apiKeys.revokedAt),
  ];

  if (options.requestId) {
    conditions.push(eq(costEvents.requestId, options.requestId));
  }
  if (options.apiKeyId) {
    conditions.push(eq(costEvents.apiKeyId, options.apiKeyId));
  }
  if (options.model) {
    conditions.push(eq(costEvents.model, options.model));
  }
  if (options.provider) {
    conditions.push(eq(costEvents.provider, options.provider));
  }
  if (options.source) {
    conditions.push(eq(costEvents.source, options.source));
  }
  if (options.traceId) {
    conditions.push(eq(costEvents.traceId, options.traceId));
  }
  if (options.tags && Object.keys(options.tags).length > 0) {
    conditions.push(sql`${costEvents.tags} @> ${JSON.stringify(options.tags)}::jsonb`);
  }

  if (options.cursor) {
    const cursorDate = new Date(options.cursor.createdAt);
    conditions.push(
      or(
        lt(costEvents.createdAt, cursorDate),
        and(
          eq(costEvents.createdAt, cursorDate),
          lt(costEvents.id, options.cursor.id),
        ),
      )!,
    );
  }

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
      source: costEvents.source,
      tags: costEvents.tags,
      keyName: apiKeys.name,
    })
    .from(costEvents)
    .innerJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(and(...conditions))
    .orderBy(desc(costEvents.createdAt), desc(costEvents.id))
    .limit(options.limit + 1);

  const hasMore = rows.length > options.limit;
  const pageRows = hasMore ? rows.slice(0, options.limit) : rows;
  const lastRow = pageRows[pageRows.length - 1];

  return {
    data: pageRows.map(serializeCostEvent),
    cursor:
      hasMore && lastRow
        ? { createdAt: lastRow.createdAt.toISOString(), id: lastRow.id }
        : null,
  };
}
