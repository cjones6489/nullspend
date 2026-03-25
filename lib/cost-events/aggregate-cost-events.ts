import { and, desc, eq, gte, or, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { apiKeys, costEvents } from "@nullspend/db";

export interface AggregateOptions {
  excludeEstimated?: boolean;
}

/** Exclude cost events tagged as estimated (cancelled stream estimates). */
const NOT_ESTIMATED = sql`NOT (${costEvents.tags} @> '{"_ns_estimated":"true"}'::jsonb)`;

function baseConditions(orgId: string, cutoffDate: Date, options?: AggregateOptions) {
  const conditions = [
    eq(costEvents.orgId, orgId),
    gte(costEvents.createdAt, cutoffDate),
  ];
  if (options?.excludeEstimated) {
    conditions.push(NOT_ESTIMATED);
  }
  return and(...conditions);
}

function makeCutoff(periodDays: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - (periodDays - 1) * 86_400_000);
}

const dateExpr = sql<string>`(${costEvents.createdAt} AT TIME ZONE 'UTC')::date::text`;

export async function getDailySpend(orgId: string, periodDays: number, options?: AggregateOptions) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  return db
    .select({
      date: dateExpr,
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
    })
    .from(costEvents)
    .where(baseConditions(orgId, cutoff, options))
    .groupBy(dateExpr)
    .orderBy(dateExpr);
}

export async function getModelBreakdown(orgId: string, periodDays: number, options?: AggregateOptions) {
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
    .where(baseConditions(orgId, cutoff, options))
    .groupBy(costEvents.provider, costEvents.model)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`))
    .limit(100);
}

export async function getProviderBreakdown(orgId: string, periodDays: number, options?: AggregateOptions) {
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
    .where(baseConditions(orgId, cutoff, options))
    .groupBy(costEvents.provider)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`))
    .limit(25);
}

export async function getKeyBreakdown(orgId: string, periodDays: number, options?: AggregateOptions) {
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
    .where(and(baseConditions(orgId, cutoff, options), sql`${costEvents.apiKeyId} IS NOT NULL`))
    .groupBy(costEvents.apiKeyId, apiKeys.name)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`))
    .limit(100);
}

export async function getSourceBreakdown(orgId: string, periodDays: number, options?: AggregateOptions) {
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
    .where(baseConditions(orgId, cutoff, options))
    .groupBy(costEvents.source)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`))
    .limit(25);
}

export async function getToolBreakdown(orgId: string, periodDays: number, options?: AggregateOptions) {
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
    .where(and(baseConditions(orgId, cutoff, options), or(eq(costEvents.eventType, "tool"), eq(costEvents.provider, "mcp"))))
    .groupBy(costEvents.model)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`))
    .limit(100);
}

export async function getCostBreakdownTotals(orgId: string, periodDays: number, options?: AggregateOptions) {
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
    .where(baseConditions(orgId, cutoff, options));

  return row ?? { inputCost: 0, outputCost: 0, cachedCost: 0, reasoningCost: 0 };
}

export async function getTraceBreakdown(orgId: string, periodDays: number, options?: AggregateOptions) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  return db
    .select({
      traceId: costEvents.traceId,
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      requestCount: sql`cast(count(*) as int)`.mapWith(Number),
    })
    .from(costEvents)
    .where(and(baseConditions(orgId, cutoff, options), sql`${costEvents.traceId} IS NOT NULL`))
    .groupBy(costEvents.traceId)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`))
    .limit(25);
}

export async function getTotals(orgId: string, periodDays: number, options?: AggregateOptions) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  const [row] = await db
    .select({
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      totalRequests: sql`cast(count(*) as int)`.mapWith(Number),
    })
    .from(costEvents)
    .where(baseConditions(orgId, cutoff, options));

  return row ?? { totalCostMicrodollars: 0, totalRequests: 0 };
}
