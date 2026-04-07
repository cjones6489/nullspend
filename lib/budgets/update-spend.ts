import { eq, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { budgets } from "@nullspend/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetSpendEntity {
  id: string;
  entityType: string;
  entityId: string;
  previousSpend: number;
  newSpend: number;
  maxBudget: number;
  thresholdPercentages: number[];
}

export interface BudgetSpendResult {
  updatedEntities: BudgetSpendEntity[];
}

// ---------------------------------------------------------------------------
// Budget spend update
// ---------------------------------------------------------------------------

/**
 * Increment budget spend for all matching budget entities after a cost event
 * is ingested via the dashboard API or MCP path.
 *
 * Mirrors the proxy's `updateBudgetSpend` pattern:
 * - Sorts entities before update to prevent deadlocks
 * - Uses atomic SQL increment (not read-then-write)
 * - Returns pre/post spend for threshold detection
 *
 * Matches budget entities by: api_key, user, tag, and customer budgets (same as proxy).
 */
export async function updateBudgetSpendFromCostEvent(
  orgId: string,
  apiKeyId: string | null,
  costMicrodollars: number,
  tags?: Record<string, string>,
  userId?: string,
  customerId?: string | null,
): Promise<BudgetSpendResult> {
  if (costMicrodollars <= 0) return { updatedEntities: [] };

  const db = getDb();

  // Find all matching budget entities for this org
  const matchingBudgets = await db
    .select({
      id: budgets.id,
      entityType: budgets.entityType,
      entityId: budgets.entityId,
      spendMicrodollars: budgets.spendMicrodollars,
      maxBudgetMicrodollars: budgets.maxBudgetMicrodollars,
      thresholdPercentages: budgets.thresholdPercentages,
    })
    .from(budgets)
    .where(eq(budgets.orgId, orgId));

  // Filter to entities that match this cost event.
  // Matches: api_key (by key ID), user (by user ID), tag (by key=value), customer (by customer ID).
  // Same entity types the proxy matches in lookupBudgetsForDO.
  //
  // NOTE: If BOTH a customer budget (entityType="customer", entityId="acme-corp") AND
  // a tag budget (entityType="tag", entityId="customer=acme-corp") exist for the same
  // customer, BOTH will be charged. This is intentional but may surprise users.
  // Budget conflict prevention should be enforced at creation time in the UI.
  const entitiesToUpdate = matchingBudgets.filter((b) => {
    if (b.entityType === "api_key" && apiKeyId && b.entityId === apiKeyId) return true;
    if (b.entityType === "user" && userId && b.entityId === userId) return true;
    if (b.entityType === "customer" && customerId && b.entityId === customerId) return true;
    if (b.entityType === "tag" && tags) {
      // Tag budgets have entityId format "key=value"
      const eqIdx = b.entityId.indexOf("=");
      if (eqIdx === -1) return false;
      const tagKey = b.entityId.slice(0, eqIdx);
      const tagValue = b.entityId.slice(eqIdx + 1);
      return tags[tagKey] === tagValue;
    }
    return false;
  });

  if (entitiesToUpdate.length === 0) return { updatedEntities: [] };

  // Sort by (entityType, entityId) to prevent deadlocks — same as proxy
  entitiesToUpdate.sort((a, b) => {
    const typeCmp = a.entityType.localeCompare(b.entityType);
    if (typeCmp !== 0) return typeCmp;
    return a.entityId.localeCompare(b.entityId);
  });

  const updatedEntities: BudgetSpendEntity[] = [];

  // Update each entity atomically
  await db.transaction(async (tx) => {
    for (const entity of entitiesToUpdate) {
      const [updated] = await tx
        .update(budgets)
        .set({
          spendMicrodollars: sql`${budgets.spendMicrodollars} + ${costMicrodollars}`,
          updatedAt: new Date(),
        })
        .where(eq(budgets.id, entity.id))
        .returning({
          id: budgets.id,
          spendMicrodollars: budgets.spendMicrodollars,
        });

      if (updated) {
        updatedEntities.push({
          id: entity.id,
          entityType: entity.entityType,
          entityId: entity.entityId,
          previousSpend: entity.spendMicrodollars,
          newSpend: updated.spendMicrodollars,
          maxBudget: entity.maxBudgetMicrodollars,
          thresholdPercentages: entity.thresholdPercentages,
        });
      }
    }
  });

  return { updatedEntities };
}
