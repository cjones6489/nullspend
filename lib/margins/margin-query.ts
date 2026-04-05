import { and, eq, gte, sql, desc } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  costEvents,
  customerMappings,
  customerRevenue,
  stripeConnections,
} from "@nullspend/db";
import { formatPeriod } from "./periods";

// ── Health tiers ─────────────────────────────────────────────────────

export type HealthTier = "healthy" | "moderate" | "at_risk" | "critical";

export function computeHealthTier(marginPercent: number): HealthTier {
  if (marginPercent >= 50) return "healthy";
  if (marginPercent >= 20) return "moderate";
  if (marginPercent >= 0) return "at_risk";
  return "critical";
}

// ── Types ────────────────────────────────────────────────────────────

export interface CustomerMargin {
  stripeCustomerId: string;
  customerName: string | null;
  avatarUrl: string | null;
  tagValue: string;
  revenueMicrodollars: number;
  costMicrodollars: number;
  marginMicrodollars: number;
  marginPercent: number;
  healthTier: HealthTier;
  sparkline: { period: string; marginPercent: number }[];
  budgetSuggestionMicrodollars: number | null;
}

export interface MarginSummary {
  blendedMarginPercent: number;
  totalRevenueMicrodollars: number;
  totalCostMicrodollars: number;
  criticalCount: number;
  atRiskCount: number;
  lastSyncAt: string | null;
  syncStatus: string;
}

export interface MarginTableResult {
  summary: MarginSummary;
  customers: CustomerMargin[];
}

// ── Main query ───────────────────────────────────────────────────────

export async function getMarginTable(
  orgId: string,
  period: string, // "YYYY-MM"
): Promise<MarginTableResult> {
  const db = getDb();

  // Get connection status for stale-data contract
  const [connection] = await db
    .select({
      lastSyncAt: stripeConnections.lastSyncAt,
      status: stripeConnections.status,
    })
    .from(stripeConnections)
    .where(eq(stripeConnections.orgId, orgId))
    .limit(1);

  const lastSyncAt = connection?.lastSyncAt?.toISOString() ?? null;
  const syncStatus = connection?.status ?? "disconnected";

  // Get periods for sparkline (3 months including requested)
  const [year, month] = period.split("-").map(Number);
  const requestedPeriod = new Date(Date.UTC(year, month - 1, 1));
  const sparklinePeriods = [
    new Date(Date.UTC(year, month - 3, 1)),
    new Date(Date.UTC(year, month - 2, 1)),
    requestedPeriod,
  ];

  // Get all mappings for this org
  const mappings = await db
    .select()
    .from(customerMappings)
    .where(
      and(
        eq(customerMappings.orgId, orgId),
        eq(customerMappings.tagKey, "customer"),
      ),
    );

  if (mappings.length === 0) {
    return {
      summary: {
        blendedMarginPercent: 0,
        totalRevenueMicrodollars: 0,
        totalCostMicrodollars: 0,
        criticalCount: 0,
        atRiskCount: 0,
        lastSyncAt,
        syncStatus,
      },
      customers: [],
    };
  }

  // Get revenue for all periods
  const oldestPeriod = sparklinePeriods[0];
  const revenueRows = await db
    .select()
    .from(customerRevenue)
    .where(
      and(
        eq(customerRevenue.orgId, orgId),
        gte(customerRevenue.periodStart, oldestPeriod),
      ),
    );

  // Build revenue lookup: stripeCustomerId -> period -> amount
  const revenueLookup = new Map<string, Map<string, { amount: number; name: string | null; avatar: string | null }>>();
  for (const row of revenueRows) {
    const period = formatPeriod(row.periodStart);
    if (!revenueLookup.has(row.stripeCustomerId)) {
      revenueLookup.set(row.stripeCustomerId, new Map());
    }
    revenueLookup.get(row.stripeCustomerId)!.set(period, {
      amount: row.amountMicrodollars,
      name: row.customerName,
      avatar: row.avatarUrl,
    });
  }

  // Get cost by customer tag for all sparkline periods
  const tagValues = mappings.map((m) => m.tagValue);

  // Short-circuit: no tag values means no cost data to query
  const costRows = tagValues.length === 0 ? [] : await db
    .select({
      tagValue: sql<string>`${costEvents.tags}->>'customer'`.mapWith(String),
      period: sql<string>`to_char(${costEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`.mapWith(String),
      totalCost: sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.orgId, orgId),
        gte(costEvents.createdAt, oldestPeriod),
        sql`${costEvents.tags}->>'customer' IN (${sql.join(tagValues.map(v => sql`${v}`), sql`, `)})`,
      ),
    )
    .groupBy(
      sql`${costEvents.tags}->>'customer'`,
      sql`to_char(${costEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`,
    );

  // Build cost lookup: tagValue -> period -> cost
  const costLookup = new Map<string, Map<string, number>>();
  for (const row of costRows) {
    if (!costLookup.has(row.tagValue)) {
      costLookup.set(row.tagValue, new Map());
    }
    costLookup.get(row.tagValue)!.set(row.period, row.totalCost);
  }

  // Build customer margins
  const requestedPeriodStr = formatPeriod(requestedPeriod);
  const customers: CustomerMargin[] = [];
  let totalRevenue = 0;
  let totalCost = 0;
  let criticalCount = 0;
  let atRiskCount = 0;

  for (const mapping of mappings) {
    const revenueByPeriod = revenueLookup.get(mapping.stripeCustomerId);
    const costByPeriod = costLookup.get(mapping.tagValue);

    const periodRevenue = revenueByPeriod?.get(requestedPeriodStr)?.amount ?? 0;
    const periodCost = costByPeriod?.get(requestedPeriodStr) ?? 0;
    const name = revenueByPeriod?.get(requestedPeriodStr)?.name ?? null;
    const avatar = revenueByPeriod?.get(requestedPeriodStr)?.avatar ?? null;

    const marginMicrodollars = periodRevenue - periodCost;
    const marginPercent = periodRevenue > 0
      ? ((periodRevenue - periodCost) / periodRevenue) * 100
      : periodCost > 0 ? -100 : 0;
    const healthTier = computeHealthTier(marginPercent);

    // Sparkline data
    const sparkline = sparklinePeriods.map((p) => {
      const pStr = formatPeriod(p);
      const rev = revenueByPeriod?.get(pStr)?.amount ?? 0;
      const cost = costByPeriod?.get(pStr) ?? 0;
      const mp = rev > 0 ? ((rev - cost) / rev) * 100 : cost > 0 ? -100 : 0;
      return { period: pStr, marginPercent: Math.round(mp * 100) / 100 };
    });

    // Budget suggestion for critical customers
    const budgetSuggestionMicrodollars = healthTier === "critical" && periodRevenue > 0
      ? Math.round(periodRevenue * 0.5) // maxBudget = revenue * (1 - 0.5)
      : null;

    totalRevenue += periodRevenue;
    totalCost += periodCost;
    if (healthTier === "critical") criticalCount++;
    if (healthTier === "at_risk") atRiskCount++;

    customers.push({
      stripeCustomerId: mapping.stripeCustomerId,
      customerName: name,
      avatarUrl: avatar,
      tagValue: mapping.tagValue,
      revenueMicrodollars: periodRevenue,
      costMicrodollars: periodCost,
      marginMicrodollars,
      marginPercent: Math.round(marginPercent * 100) / 100,
      healthTier,
      sparkline,
      budgetSuggestionMicrodollars,
    });
  }

  // Sort by margin % ascending (worst first)
  customers.sort((a, b) => a.marginPercent - b.marginPercent);

  const blendedMarginPercent = totalRevenue > 0
    ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 10000) / 100
    : 0;

  return {
    summary: {
      blendedMarginPercent,
      totalRevenueMicrodollars: totalRevenue,
      totalCostMicrodollars: totalCost,
      criticalCount,
      atRiskCount,
      lastSyncAt,
      syncStatus,
    },
    customers,
  };
}

// ── Customer detail query ────────────────────────────────────────────

export interface CustomerDetail {
  stripeCustomerId: string;
  customerName: string | null;
  avatarUrl: string | null;
  tagValue: string;
  healthTier: HealthTier;
  marginPercent: number;
  revenueMicrodollars: number;
  costMicrodollars: number;
  revenueOverTime: { period: string; revenue: number; cost: number }[];
  modelBreakdown: { model: string; cost: number; requestCount: number }[];
}

export async function getCustomerDetail(
  orgId: string,
  tagValue: string,
  period: string,
): Promise<CustomerDetail | null> {
  const db = getDb();

  // Find mapping
  const [mapping] = await db
    .select()
    .from(customerMappings)
    .where(
      and(
        eq(customerMappings.orgId, orgId),
        eq(customerMappings.tagKey, "customer"),
        eq(customerMappings.tagValue, tagValue),
      ),
    )
    .limit(1);

  if (!mapping) return null;

  const [year, month] = period.split("-").map(Number);
  const sparklinePeriods = [
    new Date(Date.UTC(year, month - 3, 1)),
    new Date(Date.UTC(year, month - 2, 1)),
    new Date(Date.UTC(year, month - 1, 1)),
  ];
  const oldestPeriod = sparklinePeriods[0];
  const requestedPeriod = sparklinePeriods[2];
  const requestedPeriodStr = formatPeriod(requestedPeriod);

  // Revenue over time
  const revenueRows = await db
    .select()
    .from(customerRevenue)
    .where(
      and(
        eq(customerRevenue.orgId, orgId),
        eq(customerRevenue.stripeCustomerId, mapping.stripeCustomerId),
        gte(customerRevenue.periodStart, oldestPeriod),
      ),
    );

  // Cost over time
  const costRows = await db
    .select({
      period: sql<string>`to_char(${costEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`.mapWith(String),
      totalCost: sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.orgId, orgId),
        gte(costEvents.createdAt, oldestPeriod),
        sql`${costEvents.tags}->>'customer' = ${tagValue}`,
      ),
    )
    .groupBy(sql`to_char(${costEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM')`);

  const costByPeriod = new Map(costRows.map((r) => [r.period, r.totalCost]));

  const revenueOverTime = sparklinePeriods.map((p) => {
    const pStr = formatPeriod(p);
    const revRow = revenueRows.find((r) => formatPeriod(r.periodStart) === pStr);
    return {
      period: pStr,
      revenue: revRow?.amountMicrodollars ?? 0,
      cost: costByPeriod.get(pStr) ?? 0,
    };
  });

  // Model breakdown for requested period
  const modelRows = await db
    .select({
      model: costEvents.model,
      cost: sql`cast(coalesce(sum(${costEvents.costMicrodollars}), 0) as bigint)`.mapWith(Number),
      requestCount: sql`cast(count(*) as int)`.mapWith(Number),
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.orgId, orgId),
        gte(costEvents.createdAt, requestedPeriod),
        sql`${costEvents.tags}->>'customer' = ${tagValue}`,
        sql`to_char(${costEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM') = ${requestedPeriodStr}`,
      ),
    )
    .groupBy(costEvents.model)
    .orderBy(desc(sql`sum(${costEvents.costMicrodollars})`));

  // Current period totals
  const periodRevenue = revenueOverTime.find((r) => r.period === requestedPeriodStr)?.revenue ?? 0;
  const periodCost = revenueOverTime.find((r) => r.period === requestedPeriodStr)?.cost ?? 0;
  const marginPercent = periodRevenue > 0
    ? Math.round(((periodRevenue - periodCost) / periodRevenue) * 10000) / 100
    : periodCost > 0 ? -100 : 0;

  const revenueRow = revenueRows.find((r) => formatPeriod(r.periodStart) === requestedPeriodStr);

  return {
    stripeCustomerId: mapping.stripeCustomerId,
    customerName: revenueRow?.customerName ?? null,
    avatarUrl: revenueRow?.avatarUrl ?? null,
    tagValue: mapping.tagValue,
    healthTier: computeHealthTier(marginPercent),
    marginPercent,
    revenueMicrodollars: periodRevenue,
    costMicrodollars: periodCost,
    revenueOverTime,
    modelBreakdown: modelRows.map((r) => ({
      model: r.model,
      cost: r.cost,
      requestCount: r.requestCount,
    })),
  };
}
