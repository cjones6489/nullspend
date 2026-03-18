import { waitUntil } from "cloudflare:workers";
import type { Redis } from "@upstash/redis/cloudflare";
import type { RequestContext } from "./context.js";
import type { BudgetEntity } from "./budget-lookup.js";
import { lookupBudgets } from "./budget-lookup.js";
import { checkAndReserve } from "./budget.js";
import { reconcileReservation } from "./budget-reconcile.js";
import { lookupBudgetsForDO } from "./budget-do-lookup.js";
import { doBudgetCheck, doBudgetReconcile, doBudgetPopulate } from "./budget-do-client.js";
import { resetBudgetPeriod } from "./budget-spend.js";
import { enqueueReconciliation } from "./reconciliation-queue.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BudgetEngineMode = "redis" | "durable-objects" | "shadow";

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

const VALID_MODES = new Set<string>(["redis", "durable-objects", "shadow"]);

function validateMode(raw: string): BudgetEngineMode {
  if (VALID_MODES.has(raw)) return raw as BudgetEngineMode;
  console.warn(`[budget-orchestrator] Unknown BUDGET_ENGINE="${raw}", falling back to redis`);
  return "redis";
}

export function resolveBudgetMode(env: Env): BudgetEngineMode {
  return validateMode(env.BUDGET_ENGINE || "redis");
}

export function parseShadowSampleRate(env: Env): number {
  const raw = parseFloat(env.SHADOW_SAMPLE_RATE || "0");
  if (isNaN(raw)) return 0;
  return Math.max(0, Math.min(1, raw));
}

// ---------------------------------------------------------------------------
// checkBudget
// ---------------------------------------------------------------------------

export async function checkBudget(
  mode: BudgetEngineMode,
  env: Env,
  ctx: RequestContext,
  estimateMicrodollars: number,
): Promise<BudgetCheckOutcome> {
  const skipped: BudgetCheckOutcome = {
    status: "skipped",
    reservationId: null,
    budgetEntities: [],
  };

  if (!ctx.auth.hasBudgets) return skipped;

  const identity = { keyId: ctx.auth.keyId, userId: ctx.auth.userId };

  if (mode === "redis") {
    if (!ctx.redis) return skipped;
    return checkBudgetRedis(ctx.redis, ctx.connectionString, identity, estimateMicrodollars);
  }

  if (mode === "durable-objects") {
    return checkBudgetDO(env, ctx.connectionString, identity, estimateMicrodollars);
  }

  // shadow: Redis is primary, DO runs in background
  if (!ctx.redis) return skipped;

  const redisResult = await checkBudgetRedis(
    ctx.redis, ctx.connectionString, identity, estimateMicrodollars,
  );

  // Sample: skip DO shadow for this request unless sampled
  const sampleRate = parseShadowSampleRate(env);
  if (sampleRate <= 0 || Math.random() >= sampleRate) {
    return redisResult;
  }

  // Run DO in waitUntil for comparison
  waitUntil((async () => {
    const t0 = performance.now();
    let doResult: BudgetCheckOutcome | null = null;
    let doError: string | null = null;

    try {
      doResult = await checkBudgetDO(
        env, ctx.connectionString, identity, estimateMicrodollars,
      );
    } catch (err) {
      doError = err instanceof Error ? err.message : String(err);
    }

    const doLatencyMs = Math.round(performance.now() - t0);

    try {
      emitShadowMetric(identity, redisResult, doResult, doError, doLatencyMs, estimateMicrodollars);
    } catch (metricErr) {
      console.error("[budget-shadow] Metric emission failed:", metricErr);
    }
  })());

  return redisResult;
}

// ---------------------------------------------------------------------------
// reconcileBudget
// ---------------------------------------------------------------------------

export async function reconcileBudget(
  mode: BudgetEngineMode,
  env: Env,
  userId: string | null,
  reservationId: string | null,
  actualCost: number,
  budgetEntities: BudgetEntity[],
  connectionString: string,
  redis: Redis | null,
): Promise<void> {
  try {
    if (mode === "redis") {
      if (reservationId && redis) {
        await reconcileReservation(redis, reservationId, actualCost, budgetEntities, connectionString);
      }
      return;
    }

    if (mode === "durable-objects") {
      if (reservationId && userId) {
        const entities = budgetEntities.map((e) => ({
          entityType: e.entityType,
          entityId: e.entityId,
        }));
        await doBudgetReconcile(env, userId, reservationId, actualCost, entities, connectionString);
      }
      return;
    }

    // shadow: only reconcile Redis. DO reservation is shadow-only —
    // reconciling with the Redis reservation ID would cause double Postgres writes.
    // The DO's orphaned shadow reservation is cleaned up by its alarm handler (30s TTL).
    if (reservationId && redis) {
      await reconcileReservation(redis, reservationId, actualCost, budgetEntities, connectionString);
    }
  } catch (err) {
    console.error("[budget-orchestrator] Reconciliation failed:", err);
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
  mode: BudgetEngineMode,
  env: Env,
  userId: string | null,
  reservationId: string | null,
  actualCost: number,
  budgetEntities: BudgetEntity[],
  connectionString: string,
  redis: Redis | null,
): Promise<void> {
  if (queue && reservationId) {
    try {
      await enqueueReconciliation(queue, {
        type: "reconcile",
        mode,
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
  await reconcileBudget(mode, env, userId, reservationId, actualCost, budgetEntities, connectionString, redis);
}

// ---------------------------------------------------------------------------
// Internal: Redis path
// ---------------------------------------------------------------------------

async function checkBudgetRedis(
  redis: Redis,
  connectionString: string,
  identity: { keyId: string | null; userId: string | null },
  estimateMicrodollars: number,
): Promise<BudgetCheckOutcome> {
  const budgetEntities = await lookupBudgets(redis, connectionString, identity);

  if (budgetEntities.length === 0) {
    return { status: "skipped", reservationId: null, budgetEntities: [] };
  }

  const entityKeys = budgetEntities.map((e) => e.entityKey);
  const checkResult = await checkAndReserve(redis, entityKeys, estimateMicrodollars);

  if (checkResult.status === "denied") {
    // Map entityKey back to entityType/entityId
    const deniedEntity = budgetEntities.find((e) => e.entityKey === checkResult.entityKey);
    const reserved = (checkResult.maxBudget ?? 0) - (checkResult.spend ?? 0) - (checkResult.remaining ?? 0);
    return {
      status: "denied",
      reservationId: null,
      budgetEntities,
      deniedEntityType: deniedEntity?.entityType,
      deniedEntityId: deniedEntity?.entityId,
      remaining: checkResult.remaining,
      maxBudget: checkResult.maxBudget,
      spend: checkResult.spend,
      reserved,
    };
  }

  return {
    status: "approved",
    reservationId: checkResult.reservationId,
    budgetEntities,
  };
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

  const doEntities = await lookupBudgetsForDO(connectionString, identity);

  if (doEntities.length === 0) {
    return { status: "skipped", reservationId: null, budgetEntities: [] };
  }

  // Seed DO on cold start
  await doBudgetPopulate(env, userId, doEntities);

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

// ---------------------------------------------------------------------------
// Shadow metric emission
// ---------------------------------------------------------------------------

interface ShadowMetricEvent {
  _event: "budget_shadow_sample";
  userId: string | null;
  keyId: string | null;
  redisStatus: "approved" | "denied" | "skipped";
  doStatus: "approved" | "denied" | "skipped" | "error";
  divergenceType: "none" | "strict" | "soft" | "error";
  doLatencyMs: number;
  doError: string | null;
  redisRemaining?: number;
  doRemaining?: number;
  redisSpend?: number;
  doSpend?: number;
  redisMaxBudget?: number;
  doMaxBudget?: number;
  estimateMicrodollars: number;
  timestamp: number;
}

function emitShadowMetric(
  identity: { keyId: string | null; userId: string | null },
  redisResult: BudgetCheckOutcome,
  doResult: BudgetCheckOutcome | null,
  doError: string | null,
  doLatencyMs: number,
  estimateMicrodollars: number,
): void {
  const doStatus: ShadowMetricEvent["doStatus"] = doError
    ? "error"
    : doResult
      ? doResult.status
      : "error";

  let divergenceType: ShadowMetricEvent["divergenceType"];
  if (doError || !doResult) {
    divergenceType = "error";
  } else if (redisResult.status === doResult.status) {
    divergenceType = "none";
  } else if (
    (redisResult.status === "denied" && doResult.status === "approved") ||
    (redisResult.status === "approved" && doResult.status === "denied")
  ) {
    divergenceType = "strict";
  } else {
    divergenceType = "soft";
  }

  const event: ShadowMetricEvent = {
    _event: "budget_shadow_sample",
    userId: identity.userId,
    keyId: identity.keyId,
    redisStatus: redisResult.status,
    doStatus,
    divergenceType,
    doLatencyMs,
    doError,
    redisRemaining: redisResult.remaining,
    doRemaining: doResult?.remaining,
    redisSpend: redisResult.spend,
    doSpend: doResult?.spend,
    redisMaxBudget: redisResult.maxBudget,
    doMaxBudget: doResult?.maxBudget,
    estimateMicrodollars,
    timestamp: Date.now(),
  };

  console.log(JSON.stringify(event));

  if (divergenceType === "strict") {
    console.warn("[budget-shadow] STRICT divergence", {
      userId: identity.userId,
      redisStatus: redisResult.status,
      doStatus,
      doLatencyMs,
    });
  }
}
