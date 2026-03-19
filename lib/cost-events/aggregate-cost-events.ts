import { and, desc, eq, gte, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { apiKeys, costEvents } from "@nullspend/db";

function baseConditions(userId: string, cutoffDate: Date) {
  return and(
    or(eq(costEvents.userId, userId), eq(apiKeys.userId, userId)),
    gte(costEvents.createdAt, cutoffDate),
  );
}

function makeCutoff(periodDays: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - (periodDays - 1) * 86_400_000);
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
    .leftJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(baseConditions(userId, cutoff))
    .groupBy(dateExpr)
    .orderBy(dateExpr);
}

export async function getModelBreakdown(userId: string, periodDays: number) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  return db
    .select({
      provider: costEvents.provider,
      model: costEvents.model,
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      requestCount: sql`cast(count(*) as int)`.mapWith(Number),
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
    .leftJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(baseConditions(userId, cutoff))
    .groupBy(costEvents.provider, costEvents.model)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`));
}

export async function getProviderBreakdown(userId: string, periodDays: number) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  return db
    .select({
      provider: costEvents.provider,
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      requestCount: sql`cast(count(*) as int)`.mapWith(Number),
    })
    .from(costEvents)
    .leftJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(baseConditions(userId, cutoff))
    .groupBy(costEvents.provider)
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
      requestCount: sql`cast(count(*) as int)`.mapWith(Number),
    })
    .from(costEvents)
    .leftJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(baseConditions(userId, cutoff))
    .groupBy(costEvents.apiKeyId, apiKeys.name)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`));
}

export async function getSourceBreakdown(userId: string, periodDays: number) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  return db
    .select({
      source: costEvents.source,
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      requestCount: sql`cast(count(*) as int)`.mapWith(Number),
    })
    .from(costEvents)
    .leftJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(baseConditions(userId, cutoff))
    .groupBy(costEvents.source)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`));
}

export async function getToolBreakdown(userId: string, periodDays: number) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  return db
    .select({
      model: costEvents.model,
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      requestCount: sql`cast(count(*) as int)`.mapWith(Number),
      avgDurationMs:
        sql`cast(coalesce(avg(${costEvents.durationMs}), 0) as int)`.mapWith(Number),
    })
    .from(costEvents)
    .leftJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(and(baseConditions(userId, cutoff), or(eq(costEvents.eventType, "tool"), eq(costEvents.provider, "mcp"))))
    .groupBy(costEvents.model)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`));
}

export async function getCostBreakdownTotals(userId: string, periodDays: number) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  const [row] = await db
    .select({
      inputCost: sql`cast(coalesce(sum((${costEvents.costBreakdown}->>'input')::numeric), 0) as bigint)`.mapWith(Number),
      outputCost: sql`cast(coalesce(sum((${costEvents.costBreakdown}->>'output')::numeric), 0) as bigint)`.mapWith(Number),
      cachedCost: sql`cast(coalesce(sum((${costEvents.costBreakdown}->>'cached')::numeric), 0) as bigint)`.mapWith(Number),
      reasoningCost: sql`cast(coalesce(sum((${costEvents.costBreakdown}->>'reasoning')::numeric), 0) as bigint)`.mapWith(Number),
    })
    .from(costEvents)
    .leftJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(baseConditions(userId, cutoff));

  return row ?? { inputCost: 0, outputCost: 0, cachedCost: 0, reasoningCost: 0 };
}

export async function getTotals(userId: string, periodDays: number) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  const [row] = await db
    .select({
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      totalRequests: sql`cast(count(*) as int)`.mapWith(Number),
    })
    .from(costEvents)
    .leftJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(baseConditions(userId, cutoff));

  return row ?? { totalCostMicrodollars: 0, totalRequests: 0 };
}
