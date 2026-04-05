import { and, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { customerMappings, costEvents } from "@nullspend/db";
import { getLogger } from "@/lib/observability";

const log = getLogger("auto-match");

interface MatchCandidate {
  stripeCustomerId: string;
  tagValue: string;
  matchType: "auto";
  confidence: number;
}

/**
 * Run auto-matching for an org after a Stripe sync.
 * Two matchers:
 *   1. Stripe customer.metadata.nullspend_customer exact match (confidence=1.0)
 *   2. Stripe customer ID (cus_xxx) matches tag value directly (confidence=0.9)
 *
 * Only creates new mappings; never overwrites confirmed/manual ones.
 */
export async function runAutoMatch(
  orgId: string,
  customers: { id: string; metadata?: Record<string, string> | null }[],
): Promise<number> {
  const db = getDb();

  // Get distinct customer tag values from cost_events (last 90 days to avoid full table scan)
  const lookbackCutoff = new Date(Date.now() - 90 * 86_400_000);
  const tagValues = await db
    .select({
      tagValue: sql<string>`DISTINCT ${costEvents.tags}->>'customer'`.mapWith(String),
    })
    .from(costEvents)
    .where(
      and(
        eq(costEvents.orgId, orgId),
        sql`${costEvents.tags} ? 'customer'`,
        gte(costEvents.createdAt, lookbackCutoff),
      ),
    )
    .limit(10_000);

  const tagValueSet = new Set(tagValues.map((r) => r.tagValue).filter(Boolean));
  if (tagValueSet.size === 0) return 0;

  // Get existing mappings to avoid duplicates
  const existing = await db
    .select({
      stripeCustomerId: customerMappings.stripeCustomerId,
      tagValue: customerMappings.tagValue,
    })
    .from(customerMappings)
    .where(
      and(
        eq(customerMappings.orgId, orgId),
        eq(customerMappings.tagKey, "customer"),
      ),
    );

  const existingStripeIds = new Set(existing.map((r) => r.stripeCustomerId));
  const existingTagValues = new Set(existing.map((r) => r.tagValue));

  const candidates: MatchCandidate[] = [];

  for (const customer of customers) {
    if (existingStripeIds.has(customer.id)) continue;

    // Matcher 1: metadata.nullspend_customer
    const metaValue = customer.metadata?.nullspend_customer;
    if (metaValue && tagValueSet.has(metaValue) && !existingTagValues.has(metaValue)) {
      candidates.push({
        stripeCustomerId: customer.id,
        tagValue: metaValue,
        matchType: "auto",
        confidence: 1.0,
      });
      existingTagValues.add(metaValue); // prevent double-mapping
      continue;
    }

    // Matcher 2: Stripe customer ID matches tag value
    if (tagValueSet.has(customer.id) && !existingTagValues.has(customer.id)) {
      candidates.push({
        stripeCustomerId: customer.id,
        tagValue: customer.id,
        matchType: "auto",
        confidence: 0.9,
      });
      existingTagValues.add(customer.id);
    }
  }

  if (candidates.length === 0) return 0;

  // Insert new auto-matches (ignore conflicts — another sync may have beat us)
  let inserted = 0;
  for (const c of candidates) {
    try {
      await db
        .insert(customerMappings)
        .values({
          orgId,
          stripeCustomerId: c.stripeCustomerId,
          tagKey: "customer",
          tagValue: c.tagValue,
          matchType: c.matchType,
          confidence: c.confidence,
        })
        .onConflictDoNothing();
      inserted++;
    } catch (err) {
      log.warn({ err, stripeCustomerId: c.stripeCustomerId }, "Auto-match insert failed");
    }
  }

  log.info({ orgId, candidates: candidates.length, inserted }, "Auto-match complete");
  return inserted;
}
