import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { customerRevenue, customerMappings } from "@nullspend/db";
import { getAttributionByTag } from "@/lib/cost-events/aggregate-cost-events";
import { withRequestContext, getLogger } from "@/lib/observability";

const log = getLogger("margins-unmatched");

/**
 * Drizzle's mapWith(String) calls String(null) → "null" for SQL NULLs.
 * Normalize both the literal "null" string and empty strings back to null.
 */
function normalizeNullable(v: string | null | undefined): string | null {
  if (v == null || v === "null" || v === "") return null;
  return v;
}

export const GET = withRequestContext(async (_request: Request) => {
  const { userId, orgId } = await resolveSessionContext();
  await assertOrgRole(userId, orgId, "viewer");

  const db = getDb();
  const startMs = Date.now();

  // Run all three independent queries in parallel
  const [existingMappings, revenueRows, tagAttribution] = await Promise.all([
    // 1. All existing mappings for this org
    db
      .select({
        id: customerMappings.id,
        stripeCustomerId: customerMappings.stripeCustomerId,
        tagValue: customerMappings.tagValue,
        matchType: customerMappings.matchType,
        confidence: customerMappings.confidence,
      })
      .from(customerMappings)
      .where(and(eq(customerMappings.orgId, orgId), eq(customerMappings.tagKey, "customer"))),

    // 2. Revenue rows — group only by stripeCustomerId to avoid duplicates
    //    when customerName/email changes across periods
    db
      .select({
        stripeCustomerId: customerRevenue.stripeCustomerId,
        customerName: sql<string>`max(${customerRevenue.customerName})`.mapWith(String),
        customerEmail: sql<string>`max(${customerRevenue.customerEmail})`.mapWith(String),
        totalRevenueMicrodollars:
          sql`cast(coalesce(sum(${customerRevenue.amountMicrodollars}), 0) as bigint)`.mapWith(Number),
      })
      .from(customerRevenue)
      .where(eq(customerRevenue.orgId, orgId))
      .groupBy(customerRevenue.stripeCustomerId),

    // 3. Tag values from cost_events
    getAttributionByTag(orgId, "customer", 90, 500),
  ]);

  const mappedStripeIds = new Set(existingMappings.map((m) => m.stripeCustomerId));
  const mappedTagValues = new Set(existingMappings.map((m) => m.tagValue));

  // Unmatched = in revenue but not in mappings
  const unmatchedStripeCustomers = revenueRows
    .filter((c) => !mappedStripeIds.has(c.stripeCustomerId))
    .map((c) => ({
      stripeCustomerId: c.stripeCustomerId,
      customerName: normalizeNullable(c.customerName),
      customerEmail: normalizeNullable(c.customerEmail),
      totalRevenueMicrodollars: c.totalRevenueMicrodollars,
    }));

  // Unmapped tags = tag values not in any mapping, excluding null/empty
  const unmappedTagValues = tagAttribution
    .filter((t) => t.tagValue != null && t.tagValue !== "" && t.tagValue !== "null" && !mappedTagValues.has(t.tagValue));

  // Customer name lookup for display (auto-matches + confirmed mappings)
  const revenueByStripeId = new Map(
    revenueRows.map((c) => [c.stripeCustomerId, normalizeNullable(c.customerName)] as const),
  );

  // Pending auto-matches = matchType="auto"
  const pendingAutoMatches = existingMappings
    .filter((m) => m.matchType === "auto")
    .map((m) => ({
      id: m.id,
      stripeCustomerId: m.stripeCustomerId,
      customerName: revenueByStripeId.get(m.stripeCustomerId) ?? null,
      tagValue: m.tagValue,
      confidence: m.confidence,
    }));

  // Customer name map for confirmed mappings display
  const customerNames: Record<string, string> = {};
  for (const [stripeId, name] of revenueByStripeId) {
    if (name) customerNames[stripeId] = name;
  }

  log.info(
    {
      orgId,
      durationMs: Date.now() - startMs,
      mappings: existingMappings.length,
      revenueCustomers: revenueRows.length,
      unmatchedCustomers: unmatchedStripeCustomers.length,
      unmappedTags: unmappedTagValues.length,
      pendingAutoMatches: pendingAutoMatches.length,
    },
    "Unmatched customers query complete",
  );

  return NextResponse.json({
    data: {
      unmatchedStripeCustomers,
      unmappedTagValues,
      pendingAutoMatches,
      customerNames,
    },
  });
});
