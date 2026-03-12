import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { apiKeys, costEvents } from "@agentseam/db";

function baseConditions(userId: string, cutoffDate: Date) {
  return and(
    eq(apiKeys.userId, userId),
    isNull(apiKeys.revokedAt),
    gte(costEvents.createdAt, cutoffDate),
  );
}

function makeCutoff(periodDays: number): Date {
  return new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
}

const dateExpr = sql<string>`(${costEvents.createdAt} AT TIME ZONE 'UTC')::date::text`;

export async function getDailySpend(userId: string, periodDays: number) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  return db
    .select({
      date: dateExpr,
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
    })
    .from(costEvents)
    .innerJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(baseConditions(userId, cutoff))
    .groupBy(dateExpr)
    .orderBy(dateExpr);
}

export async function getModelBreakdown(userId: string, periodDays: number) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  return db
    .select({
      model: costEvents.model,
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      requestCount: sql<number>`cast(count(*) as int)`,
      inputTokens:
        sql`cast(coalesce(sum(${costEvents.inputTokens}), 0) as bigint)`.mapWith(Number),
      outputTokens:
        sql`cast(coalesce(sum(${costEvents.outputTokens}), 0) as bigint)`.mapWith(Number),
      cachedInputTokens:
        sql`cast(coalesce(sum(${costEvents.cachedInputTokens}), 0) as bigint)`.mapWith(Number),
      reasoningTokens:
        sql`cast(coalesce(sum(${costEvents.reasoningTokens}), 0) as bigint)`.mapWith(Number),
    })
    .from(costEvents)
    .innerJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(baseConditions(userId, cutoff))
    .groupBy(costEvents.model)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`));
}

export async function getKeyBreakdown(userId: string, periodDays: number) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  return db
    .select({
      apiKeyId: costEvents.apiKeyId,
      keyName: apiKeys.name,
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      requestCount: sql<number>`cast(count(*) as int)`,
    })
    .from(costEvents)
    .innerJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(baseConditions(userId, cutoff))
    .groupBy(costEvents.apiKeyId, apiKeys.name)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`));
}

export async function getTotals(userId: string, periodDays: number) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  const [row] = await db
    .select({
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      totalRequests: sql<number>`cast(count(*) as int)`,
    })
    .from(costEvents)
    .innerJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(baseConditions(userId, cutoff));

  return row ?? { totalCostMicrodollars: 0, totalRequests: 0 };
}
