import { resolveAction } from "@/lib/actions/resolve-action";
import { executeBudgetIncrease } from "@/lib/budgets/increase";
import { invalidateProxyCache } from "@/lib/proxy-invalidate";
import { dispatchWebhookEvent, buildBudgetIncreasedPayload } from "@/lib/webhooks/dispatch";
import { getLogger } from "@/lib/observability";
import type { ApproveActionInput } from "@/lib/validations/actions";

const log = getLogger("approve-action");

export interface ApproveActionResult {
  id: string;
  status: string;
  approvedAt: string | null;
  /** Present only for budget_increase actions. */
  budgetIncrease?: { previousLimit: number; newLimit: number; amount: number; requestedAmount: number };
}

export async function approveAction(
  actionId: string,
  input: ApproveActionInput,
  orgId: string,
): Promise<ApproveActionResult> {
  let budgetIncrease: { previousLimit: number; newLimit: number; amount: number; requestedAmount: number } | undefined;

  const result = await resolveAction(
    actionId,
    orgId,
    "approved",
    { approvedBy: input.approvedBy },
    async (tx, action) => {
      if (action.actionType !== "budget_increase") return;

      budgetIncrease = await executeBudgetIncrease(
        tx,
        action.payloadJson,
        orgId,
        input.approvedAmountMicrodollars,
      );
    },
  );

  // Sync the updated budget to the proxy DO before returning (so the new limit takes effect immediately)
  // Webhook dispatch remains fire-and-forget (non-critical path)
  if (budgetIncrease) {
    log.info(
      { actionId, entityType: "budget_increase", amount: budgetIncrease.amount, requestedAmount: budgetIncrease.requestedAmount, partial: budgetIncrease.amount !== budgetIncrease.requestedAmount },
      "budget_increase_approved",
    );

    try {
      await invalidateAfterBudgetIncrease(actionId, orgId);
    } catch (err) {
      log.warn({ err, actionId }, "Budget increase proxy cache invalidation failed (will sync within 60s)");
    }

    // Dispatch budget.increased webhook event (fire-and-forget)
    void dispatchBudgetIncreasedWebhook(actionId, orgId, budgetIncrease, input.approvedBy).catch((err) => {
      log.warn({ err, actionId }, "budget.increased webhook dispatch failed");
    });
  }

  return {
    id: result.id,
    status: result.status,
    approvedAt: result.approvedAt?.toISOString() ?? null,
    budgetIncrease,
  };
}

async function invalidateAfterBudgetIncrease(actionId: string, orgId: string): Promise<void> {
  const { getDb } = await import("@/lib/db/client");
  const { actions } = await import("@nullspend/db");
  const { and, eq } = await import("drizzle-orm");

  const db = getDb();
  const [action] = await db
    .select({ payloadJson: actions.payloadJson })
    .from(actions)
    .where(and(eq(actions.id, actionId), eq(actions.orgId, orgId)))
    .limit(1);

  if (!action?.payloadJson) return;

  const payload = action.payloadJson as Record<string, unknown>;
  const entityType = payload.entityType as string;
  const entityId = payload.entityId as string;
  if (!entityType || !entityId) return;

  const { budgets } = await import("@nullspend/db");
  const [budget] = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(and(eq(budgets.orgId, orgId), eq(budgets.entityType, entityType as "user" | "api_key" | "tag"), eq(budgets.entityId, entityId)))
    .limit(1);

  if (!budget) return;

  // BDG-4: ownerId must be orgId — the proxy uses it as the org lookup key.
  // Previously sent budget.userId which caused sync to miss the correct DO.
  await invalidateProxyCache({
    action: "sync",
    ownerId: orgId,
    entityType,
    entityId,
  });
}

async function dispatchBudgetIncreasedWebhook(
  actionId: string,
  orgId: string,
  budgetIncrease: { previousLimit: number; newLimit: number; amount: number; requestedAmount: number },
  approvedBy: string,
): Promise<void> {
  const { getDb } = await import("@/lib/db/client");
  const { actions } = await import("@nullspend/db");
  const { and, eq } = await import("drizzle-orm");

  const db = getDb();
  const [action] = await db
    .select({ payloadJson: actions.payloadJson })
    .from(actions)
    .where(and(eq(actions.id, actionId), eq(actions.orgId, orgId)))
    .limit(1);

  if (!action?.payloadJson) return;

  const payload = action.payloadJson as Record<string, unknown>;
  const entityType = payload.entityType as string;
  const entityId = payload.entityId as string;
  if (!entityType || !entityId) return;

  const event = buildBudgetIncreasedPayload({
    budgetEntityType: entityType,
    budgetEntityId: entityId,
    previousLimitMicrodollars: budgetIncrease.previousLimit,
    newLimitMicrodollars: budgetIncrease.newLimit,
    increasedByMicrodollars: budgetIncrease.amount,
    approvedBy,
    actionId,
  });

  await dispatchWebhookEvent(orgId, event);
}
