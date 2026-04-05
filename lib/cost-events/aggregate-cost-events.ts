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

export async function getSourceBreakdownForEntity(
  orgId: string,
  entityType: string,
  entityId: string,
  periodDays: number,
  options?: AggregateOptions,
) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  const entityCondition =
    entityType === "api_key"
      ? eq(costEvents.apiKeyId, entityId)
      : entityType === "tag"
        ? (() => {
            const eqIdx = entityId.indexOf("=");
            if (eqIdx === -1) return sql`false`;
            const tagKey = entityId.slice(0, eqIdx);
            const tagValue = entityId.slice(eqIdx + 1);
            return sql`${costEvents.tags}->>${tagKey} = ${tagValue}`;
          })()
        : eq(costEvents.userId, entityId);

  return db
    .select({
      source: costEvents.source,
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      requestCount: sql`cast(count(*) as int)`.mapWith(Number),
    })
    .from(costEvents)
    .where(and(baseConditions(orgId, cutoff, options), entityCondition))
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

export async function getAttributionByKey(orgId: string, periodDays: number, limit: number, options?: AggregateOptions) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  return db
    .select({
      apiKeyId: costEvents.apiKeyId,
      keyName: sql<string>`coalesce(${apiKeys.name}, '(no key)')`.mapWith(String),
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      requestCount: sql`cast(count(*) as int)`.mapWith(Number),
    })
    .from(costEvents)
    .leftJoin(apiKeys, eq(costEvents.apiKeyId, apiKeys.id))
    .where(baseConditions(orgId, cutoff, options))
    .groupBy(costEvents.apiKeyId, apiKeys.name)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`))
    .limit(limit);
}

export async function getAttributionByTag(orgId: string, tagKey: string, periodDays: number, limit: number, options?: AggregateOptions) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);

  // Validate tagKey — only allow simple identifiers
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,99}$/.test(tagKey)) {
    throw new Error(`Invalid tag key: ${tagKey}`);
  }

  // Parameterized: Drizzle renders the same $N placeholder in SELECT and GROUP BY
  const tagExpr = sql<string>`${costEvents.tags}->>${tagKey}`;

  return db
    .select({
      tagValue: tagExpr.mapWith(String),
      totalCostMicrodollars:
        sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      requestCount: sql`cast(count(*) as int)`.mapWith(Number),
    })
    .from(costEvents)
    .where(baseConditions(orgId, cutoff, options))
    .groupBy(tagExpr)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`))
    .limit(limit);
}

export async function getAttributionDetailByKey(
  orgId: string,
  apiKeyId: string | null,
  periodDays: number,
  options?: AggregateOptions,
) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);
  const keyCondition = apiKeyId
    ? eq(costEvents.apiKeyId, apiKeyId)
    : sql`${costEvents.apiKeyId} IS NULL`;

  const baseWhere = and(baseConditions(orgId, cutoff, options), keyCondition);

  const [daily, models] = await Promise.all([
    db
      .select({
        date: dateExpr,
        cost: sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
        count: sql`cast(count(*) as int)`.mapWith(Number),
      })
      .from(costEvents)
      .where(baseWhere)
      .groupBy(dateExpr)
      .orderBy(dateExpr),
    db
      .select({
        model: costEvents.model,
        cost: sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
        count: sql`cast(count(*) as int)`.mapWith(Number),
      })
      .from(costEvents)
      .where(baseWhere)
      .groupBy(costEvents.model)
      .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`)),
  ]);

  return { daily, models };
}

export async function getAttributionDetailByTag(
  orgId: string,
  tagKey: string,
  tagValue: string,
  periodDays: number,
  options?: AggregateOptions,
) {
  const db = getDb();
  const cutoff = makeCutoff(periodDays);
  const tagCondition = sql`${costEvents.tags}->>${tagKey} = ${tagValue}`;
  const baseWhere = and(baseConditions(orgId, cutoff, options), tagCondition);

  const [daily, models] = await Promise.all([
    db
      .select({
        date: dateExpr,
        cost: sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
        count: sql`cast(count(*) as int)`.mapWith(Number),
      })
      .from(costEvents)
      .where(baseWhere)
      .groupBy(dateExpr)
      .orderBy(dateExpr),
    db
      .select({
        model: costEvents.model,
        cost: sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
        count: sql`cast(count(*) as int)`.mapWith(Number),
      })
      .from(costEvents)
      .where(baseWhere)
      .groupBy(costEvents.model)
      .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`)),
  ]);

  return { daily, models };
}

export async function getDistinctTagKeys(orgId: string) {
  const db = getDb();
  const cutoff = makeCutoff(7);

  const rows = await db.execute<{ key: string }>(
    sql`SELECT DISTINCT key FROM (
      SELECT jsonb_object_keys(${costEvents.tags}) AS key
      FROM ${costEvents}
      WHERE ${costEvents.orgId} = ${orgId}
        AND ${costEvents.createdAt} >= ${cutoff}
    ) sub
    WHERE key NOT LIKE '_ns_%'
    ORDER BY key
    LIMIT 50`
  );

  return Array.from(rows, (r) => r.key);
}
