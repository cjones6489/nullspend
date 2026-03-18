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
    try {
      const doResult = await checkBudgetDO(
        env, ctx.connectionString, identity, estimateMicrodollars,
      );
      compareShadowResults(redisResult, doResult);
    } catch (err) {
      console.info("[budget-shadow] DO check failed (non-blocking):", err);
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
// Shadow comparison
// ---------------------------------------------------------------------------

function compareShadowResults(
  redisResult: BudgetCheckOutcome,
  doResult: BudgetCheckOutcome,
): void {
  // Divergence-only logging — silent return on match to avoid log volume at high traffic
  if (redisResult.status === doResult.status) return;

  const detail = {
    redisStatus: redisResult.status,
    doStatus: doResult.status,
    redisSpend: redisResult.spend,
    doSpend: doResult.spend,
    redisMaxBudget: redisResult.maxBudget,
    doMaxBudget: doResult.maxBudget,
    redisReserved: redisResult.reserved,
    doReserved: doResult.reserved,
    redisRemaining: redisResult.remaining,
    doRemaining: doResult.remaining,
  };

  // One denied + one approved = strict divergence (WARN)
  // Other combos (skipped vs approved, etc.) = expected (INFO)
  const isStrictDivergence =
    (redisResult.status === "denied" && doResult.status === "approved") ||
    (redisResult.status === "approved" && doResult.status === "denied");

  if (isStrictDivergence) {
    console.warn("[budget-shadow] STRICT divergence", detail);
  } else {
    console.info("[budget-shadow] Divergence", detail);
  }
}
