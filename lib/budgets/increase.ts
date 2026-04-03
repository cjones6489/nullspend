import { and, eq, sql } from "drizzle-orm";

import { budgets } from "@nullspend/db";
import { BudgetEntityNotFoundError } from "@/lib/actions/errors";
import { budgetIncreasePayloadSchema } from "@/lib/validations/actions";
import { resolveOrgTier, assertAmountBelowCap } from "@/lib/stripe/feature-gate";
import { getLogger } from "@/lib/observability";

type BudgetEntityType = "user" | "api_key" | "tag";

const log = getLogger("budget-increase");

/**
 * Execute a budget increase as a side-effect inside a transaction.
 *
 * - Validates payload with budgetIncreasePayloadSchema
 * - Uses approvedAmountMicrodollars if provided, otherwise requestedAmountMicrodollars
 * - Reads current budget from DB (not from agent-provided payload) for tier cap
 * - Atomically increments maxBudgetMicrodollars
 * - Throws if entity not found (rolls back entire parent transaction)
 */
export async function executeBudgetIncrease(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle transaction generic is not re-exportable
  tx: Parameters<Parameters<import("drizzle-orm/pg-core").PgDatabase<any, any, any>["transaction"]>[0]>[0],
  payloadJson: Record<string, unknown> | null,
  orgId: string,
  approvedAmountMicrodollars?: number,
): Promise<{ previousLimit: number; newLimit: number; amount: number; requestedAmount: number }> {
  const payload = budgetIncreasePayloadSchema.parse(payloadJson);
  const entityType = payload.entityType as BudgetEntityType;
  const amount = approvedAmountMicrodollars ?? payload.requestedAmountMicrodollars;

  if (amount <= 0) {
    throw new Error("Budget increase amount must be positive");
  }

  // Read the actual current budget from DB — never trust client-provided values
  // for billing enforcement. Lock the row to prevent concurrent increases from
  // both passing the cap check.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle transaction generic
  const [currentBudget] = await (tx as any)
    .select({ maxBudgetMicrodollars: budgets.maxBudgetMicrodollars })
    .from(budgets)
    .where(
      and(
        eq(budgets.orgId, orgId),
        eq(budgets.entityType, entityType),
        eq(budgets.entityId, payload.entityId),
      ),
    )
    .limit(1)
    .for("update");

  if (!currentBudget) {
    throw new BudgetEntityNotFoundError(payload.entityType, payload.entityId);
  }

  // Check tier cap using the real DB value, not the agent-provided one
  const tierInfo = await resolveOrgTier(orgId);
  const newTotal = currentBudget.maxBudgetMicrodollars + amount;
  assertAmountBelowCap(tierInfo, "spendCapMicrodollars", newTotal);

  // Atomic increment
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle transaction generic
  const updated = await (tx as any)
    .update(budgets)
    .set({
      maxBudgetMicrodollars: sql`${budgets.maxBudgetMicrodollars} + ${amount}`,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(budgets.orgId, orgId),
        eq(budgets.entityType, entityType),
        eq(budgets.entityId, payload.entityId),
      ),
    )
    .returning({
      maxBudgetMicrodollars: budgets.maxBudgetMicrodollars,
    });

  if (updated.length === 0) {
    throw new BudgetEntityNotFoundError(payload.entityType, payload.entityId);
  }

  const result = {
    previousLimit: currentBudget.maxBudgetMicrodollars,
    newLimit: updated[0].maxBudgetMicrodollars,
    amount,
    requestedAmount: payload.requestedAmountMicrodollars,
  };

  log.info(
    {
      entityType: payload.entityType,
      entityId: payload.entityId,
      orgId,
      previousLimit: result.previousLimit,
      newLimit: result.newLimit,
      requested: payload.requestedAmountMicrodollars,
      approved: amount,
      partial: approvedAmountMicrodollars != null && approvedAmountMicrodollars !== payload.requestedAmountMicrodollars,
    },
    `[budget-increase] Approved: entity=${payload.entityType}/${payload.entityId} amount=${payload.requestedAmountMicrodollars}→${amount}`,
  );

  return result;
}
