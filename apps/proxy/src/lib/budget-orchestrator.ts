import { waitUntil } from "cloudflare:workers";
import type { RequestContext } from "./context.js";
import type { BudgetEntity } from "./budget-do-lookup.js";
import { doBudgetCheck, doBudgetReconcile } from "./budget-do-client.js";
import { resetBudgetPeriod } from "./budget-spend.js";
import { enqueueReconciliation } from "./reconciliation-queue.js";

export interface BudgetCheckOutcome {
  status: "approved" | "denied" | "skipped";
  reservationId: string | null;
  budgetEntities: BudgetEntity[];
  deniedEntityType?: string;
  deniedEntityId?: string;
  remaining?: number;
  maxBudget?: number;
  spend?: number;
  reserved?: number;
  velocityDenied?: boolean;
  retryAfterSeconds?: number;
  velocityDetails?: {
    limitMicrodollars: number;
    windowSeconds: number;
    currentMicrodollars: number;
  };
  velocityRecovered?: Array<{ entityType: string; entityId: string }>;
}

// ---------------------------------------------------------------------------
// checkBudget
// ---------------------------------------------------------------------------

export async function checkBudget(
  env: Env,
  ctx: RequestContext,
  estimateMicrodollars: number,
): Promise<BudgetCheckOutcome> {
  return checkBudgetDO(env, ctx.connectionString, ctx.auth.keyId, ctx.auth.userId, estimateMicrodollars);
}

// ---------------------------------------------------------------------------
// reconcileBudget
// ---------------------------------------------------------------------------

export async function reconcileBudget(
  env: Env,
  userId: string | null,
  reservationId: string | null,
  actualCost: number,
  budgetEntities: BudgetEntity[],
  connectionString: string,
  options?: { throwOnError?: boolean },
): Promise<void> {
  try {
    if (reservationId && userId) {
      const entities = budgetEntities.map((e) => ({
        entityType: e.entityType,
        entityId: e.entityId,
      }));
      const status = await doBudgetReconcile(env, userId, reservationId, actualCost, entities, connectionString);
      if (options?.throwOnError && status !== "ok") {
        throw new Error(`Reconciliation failed with status: ${status}`);
      }
    }
  } catch (err) {
    console.error("[budget-orchestrator] Reconciliation failed:", err);
    if (options?.throwOnError) throw err;
  }
}

/**
 * Extract the optional RECONCILE_QUEUE binding from env.
 * The binding is not in the generated Env type (optional infra).
 */
export function getReconcileQueue(env: Env): Queue | undefined {
  return (env as Record<string, unknown>).RECONCILE_QUEUE as Queue | undefined;
}

/**
 * Queue-aware reconciliation: attempts to enqueue to Cloudflare Queues first,
 * falls back to direct reconciliation if the queue binding is absent or send fails.
 *
 * When the queue is available, reconciliation is decoupled from the request
 * lifecycle (no 30s waitUntil limit). The consumer retries with DLQ.
 */
export async function reconcileBudgetQueued(
  queue: Queue | undefined,
  env: Env,
  userId: string | null,
  reservationId: string | null,
  actualCost: number,
  budgetEntities: BudgetEntity[],
  connectionString: string,
): Promise<void> {
  if (queue && reservationId) {
    try {
      await enqueueReconciliation(queue, {
        type: "reconcile",
        reservationId,
        actualCostMicrodollars: actualCost,
        budgetEntities: budgetEntities.map((e) => ({
          entityKey: e.entityKey,
          entityType: e.entityType,
          entityId: e.entityId,
        })),
        userId,
        enqueuedAt: Date.now(),
      });
      return;
    } catch (err) {
      console.error("[budget-orchestrator] Queue send failed, falling back to direct:", err);
    }
  }
  // Fallback: direct reconciliation (current behavior)
  await reconcileBudget(env, userId, reservationId, actualCost, budgetEntities, connectionString);
}

// ---------------------------------------------------------------------------
// Internal: DO-first path — single RPC, no Postgres on hot path
// ---------------------------------------------------------------------------

async function checkBudgetDO(
  env: Env,
  connectionString: string,
  keyId: string | null,
  userId: string | null,
  estimateMicrodollars: number,
): Promise<BudgetCheckOutcome> {
  if (!userId) {
    return { status: "skipped", reservationId: null, budgetEntities: [] };
  }

  // Single DO RPC — no Postgres lookup, no cache
  const checkResult = await doBudgetCheck(env, userId, keyId, estimateMicrodollars);

  if (!checkResult.hasBudgets) {
    return { status: "skipped", reservationId: null, budgetEntities: [] };
  }

  // Write back period resets to Postgres (registered with waitUntil to survive Worker lifecycle)
  if (checkResult.periodResets?.length && connectionString) {
    waitUntil(
      resetBudgetPeriod(connectionString, checkResult.periodResets).catch((err) => {
        console.error("[budget-orchestrator] Period reset write-back failed:", err);
      }),
    );
  }

  // Build budgetEntities from DO response
  const budgetEntities: BudgetEntity[] = (checkResult.checkedEntities ?? []).map((e) => ({
    entityKey: `{budget}:${e.entityType}:${e.entityId}`,
    entityType: e.entityType,
    entityId: e.entityId,
    maxBudget: e.maxBudget,
    spend: e.spend,
    reserved: 0,
    policy: e.policy,
  }));

  if (checkResult.status === "denied") {
    // Parse deniedEntity "type:id"
    let deniedEntityType: string | undefined;
    let deniedEntityId: string | undefined;
    if (checkResult.deniedEntity) {
      const sep = checkResult.deniedEntity.indexOf(":");
      deniedEntityType = checkResult.deniedEntity.slice(0, sep);
      deniedEntityId = checkResult.deniedEntity.slice(sep + 1);
    }

    // Velocity denial — separate from budget exhaustion
    if (checkResult.velocityDenied) {
      return {
        status: "denied",
        reservationId: null,
        budgetEntities,
        deniedEntityType,
        deniedEntityId,
        velocityDenied: true,
        retryAfterSeconds: checkResult.retryAfterSeconds,
        velocityDetails: checkResult.velocityDetails,
      };
    }

    const reserved = (checkResult.maxBudget ?? 0) - (checkResult.spend ?? 0) - (checkResult.remaining ?? 0);
    return {
      status: "denied",
      reservationId: null,
      budgetEntities,
      deniedEntityType,
      deniedEntityId,
      remaining: checkResult.remaining,
      maxBudget: checkResult.maxBudget,
      spend: checkResult.spend,
      reserved,
    };
  }

  return {
    status: "approved",
    reservationId: checkResult.reservationId ?? null,
    budgetEntities,
    ...(checkResult.velocityRecovered?.length && { velocityRecovered: checkResult.velocityRecovered }),
  };
}
