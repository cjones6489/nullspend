import { waitUntil } from "cloudflare:workers";
import type { RequestContext } from "./context.js";
import type { BudgetEntity } from "./budget-do-lookup.js";
import { lookupBudgetsForDO, type DOBudgetEntity } from "./budget-do-lookup.js";
import { doBudgetCheck, doBudgetReconcile, doBudgetPopulate } from "./budget-do-client.js";
import { resetBudgetPeriod } from "./budget-spend.js";
import { enqueueReconciliation } from "./reconciliation-queue.js";

// ---------------------------------------------------------------------------
// DO lookup cache (module-level, persists across requests in same isolate)
// ---------------------------------------------------------------------------

const DO_LOOKUP_TTL_MS = 60_000;
const DO_LOOKUP_MAX_SIZE = 256;

interface DOLookupCacheEntry {
  entities: DOBudgetEntity[];
  expiresAt: number;
}

/** @internal Exported for testing only. */
export const doLookupCache = new Map<string, DOLookupCacheEntry>();

function evictOldestIfNeeded<V>(cache: Map<string, V>, maxSize: number): void {
  if (cache.size <= maxSize) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}

function doLookupCacheKey(identity: { keyId: string | null; userId: string | null }): string {
  return `${identity.userId ?? ""}:${identity.keyId ?? ""}`;
}

/** Evict all doLookupCache entries for a given userId. */
export function invalidateDoLookupCacheForUser(userId: string): number {
  let evicted = 0;
  for (const key of [...doLookupCache.keys()]) {
    if (key.startsWith(`${userId}:`)) {
      doLookupCache.delete(key);
      evicted++;
    }
  }
  return evicted;
}

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
}

// ---------------------------------------------------------------------------
// checkBudget
// ---------------------------------------------------------------------------

export async function checkBudget(
  env: Env,
  ctx: RequestContext,
  estimateMicrodollars: number,
): Promise<BudgetCheckOutcome> {
  const identity = { keyId: ctx.auth.keyId, userId: ctx.auth.userId };
  return checkBudgetDO(env, ctx.connectionString, identity, estimateMicrodollars);
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
// Internal: DO path
// ---------------------------------------------------------------------------

async function checkBudgetDO(
  env: Env,
  connectionString: string,
  identity: { keyId: string | null; userId: string | null },
  estimateMicrodollars: number,
): Promise<BudgetCheckOutcome> {
  const userId = identity.userId;
  if (!userId) {
    return { status: "skipped", reservationId: null, budgetEntities: [] };
  }

  // Cache-first lookup: skip Postgres + DO populate on cache hit
  const cacheKey = doLookupCacheKey(identity);
  const now = Date.now();
  const cached = doLookupCache.get(cacheKey);

  let doEntities: DOBudgetEntity[];
  if (cached && cached.expiresAt > now) {
    doEntities = cached.entities;
  } else {
    doEntities = await lookupBudgetsForDO(connectionString, identity);

    // Only cache non-empty results — empty results must re-query on every
    // request so that newly-created budgets take effect immediately rather
    // than being invisible for up to 60s (fails-open).
    if (doEntities.length > 0) {
      doLookupCache.set(cacheKey, { entities: doEntities, expiresAt: now + DO_LOOKUP_TTL_MS });
      evictOldestIfNeeded(doLookupCache, DO_LOOKUP_MAX_SIZE);
    }
    // Always sync to the DO — even when Postgres returns empty — so that
    // ghost budget rows (deleted from Postgres but retained in DO) get purged.
    await doBudgetPopulate(env, userId, doEntities);
  }

  if (doEntities.length === 0) {
    return { status: "skipped", reservationId: null, budgetEntities: [] };
  }

  // Check budget
  const entities = doEntities.map((e) => ({ type: e.entityType, id: e.entityId }));
  const checkResult = await doBudgetCheck(env, userId, entities, estimateMicrodollars);

  // Write back period resets to Postgres (registered with waitUntil to survive Worker lifecycle)
  if (checkResult.periodResets?.length && connectionString) {
    waitUntil(
      resetBudgetPeriod(connectionString, checkResult.periodResets).catch((err) => {
        console.error("[budget-orchestrator] Period reset write-back failed:", err);
      }),
    );
  }

  // Build Redis-format budgetEntities for webhook payloads + reconciliation
  const budgetEntities: BudgetEntity[] = doEntities.map((e) => ({
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
  };
}
