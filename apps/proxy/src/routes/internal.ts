import { invalidateAuthCacheForUser } from "../lib/api-key-auth.js";
import { doBudgetRemove, doBudgetResetSpend, doBudgetUpsertEntities, doBudgetGetVelocityState } from "../lib/budget-do-client.js";
import { lookupBudgetsForDO } from "../lib/budget-do-lookup.js";
import { errorResponse } from "../lib/errors.js";
import { emitMetric } from "../lib/metrics.js";
import { timingSafeStringEqual } from "../lib/timing-safe-equal.js";

interface InvalidationBody {
  action: "remove" | "reset_spend" | "sync";
  userId: string;
  entityType: string;
  entityId: string;
}

const MAX_FIELD_LENGTH = 256;

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0 && val.length <= MAX_FIELD_LENGTH;
}

function parseBody(raw: unknown): InvalidationBody | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  if (obj.action !== "remove" && obj.action !== "reset_spend" && obj.action !== "sync") return null;
  if (!isNonEmptyString(obj.userId)) return null;
  if (!isNonEmptyString(obj.entityType)) return null;
  if (!isNonEmptyString(obj.entityId)) return null;

  return {
    action: obj.action,
    userId: obj.userId.trim(),
    entityType: obj.entityType.trim(),
    entityId: obj.entityId.trim(),
  };
}

export async function handleBudgetInvalidation(
  request: Request,
  env: Env,
): Promise<Response> {
  // Validate INTERNAL_SECRET is configured
  if (!env.INTERNAL_SECRET) {
    console.error("[internal] INTERNAL_SECRET not configured");
    return errorResponse("internal_error", "Server misconfigured", 500);
  }

  // Auth: timing-safe comparison of Bearer token
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse("unauthorized", "Missing or malformed Authorization header", 401);
  }

  const token = authHeader.slice(7);
  if (!timingSafeStringEqual(token, env.INTERNAL_SECRET)) {
    return errorResponse("unauthorized", "Invalid token", 401);
  }

  // Parse and validate body
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return errorResponse("bad_request", "Invalid JSON body", 400);
  }

  const body = parseBody(raw);
  if (!body) {
    return errorResponse("bad_request", "Missing or invalid fields: action (remove|reset_spend), userId, entityType, entityId", 400);
  }

  // Execute
  try {
    if (body.action === "remove") {
      await doBudgetRemove(env, body.userId, body.entityType, body.entityId);
    } else if (body.action === "reset_spend") {
      await doBudgetResetSpend(env, body.userId, body.entityType, body.entityId);
    } else {
      // action === "sync": look up specific entity from Postgres and upsert into DO
      // Uses populateIfEmpty (single-entity upsert) — does NOT purge sibling budgets
      const connectionString = env.HYPERDRIVE.connectionString;
      let identity: { keyId: string | null; userId: string | null; tags: Record<string, string> };
      if (body.entityType === "tag") {
        // Tag entities: reconstruct tags from entity_id (e.g., "project=openclaw")
        const eqIdx = body.entityId.indexOf("=");
        const tagObj = eqIdx > 0
          ? { [body.entityId.slice(0, eqIdx)]: body.entityId.slice(eqIdx + 1) }
          : { [body.entityId]: "" };
        identity = { keyId: null, userId: body.userId, tags: tagObj };
      } else if (body.entityType === "user") {
        // User entities: no keyId needed, userId is both the lookup key and the owner
        identity = { keyId: null, userId: body.userId, tags: {} };
      } else {
        // api_key / agent / team entities: entityId is the key ID
        identity = { keyId: body.entityId, userId: body.userId, tags: {} };
      }
      const entities = await lookupBudgetsForDO(connectionString, identity);
      // Empty on sync is unexpected (removes use action: "remove") — may indicate
      // Postgres commit timing or stale reads.
      if (entities.length === 0) {
        console.warn(
          `[internal] sync returned 0 entities from Postgres`,
          { userId: body.userId, entityType: body.entityType, entityId: body.entityId },
        );
        emitMetric("budget_sync_empty", {
          userId: body.userId,
          entityType: body.entityType,
          entityId: body.entityId,
        });
      }
      await doBudgetUpsertEntities(env, body.userId, entities);
    }

    invalidateAuthCacheForUser(body.userId);

    emitMetric("budget_invalidation", {
      action: body.action,
      userId: body.userId,
      entityType: body.entityType,
      entityId: body.entityId,
      status: "ok",
    });

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[internal] Budget invalidation failed:", err);

    emitMetric("budget_invalidation", {
      action: body.action,
      userId: body.userId,
      entityType: body.entityType,
      entityId: body.entityId,
      status: "error",
    });

    return errorResponse("internal_error", "Invalidation failed", 500);
  }
}

export async function handleVelocityState(
  request: Request,
  env: Env,
): Promise<Response> {
  // Validate INTERNAL_SECRET is configured
  if (!env.INTERNAL_SECRET) {
    console.error("[internal] INTERNAL_SECRET not configured");
    return errorResponse("internal_error", "Server misconfigured", 500);
  }

  // Auth: timing-safe comparison of Bearer token
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse("unauthorized", "Missing or malformed Authorization header", 401);
  }

  const token = authHeader.slice(7);
  if (!timingSafeStringEqual(token, env.INTERNAL_SECRET)) {
    return errorResponse("unauthorized", "Invalid token", 401);
  }

  // Read userId from query param
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  if (!userId || userId.length === 0 || userId.length > MAX_FIELD_LENGTH) {
    return errorResponse("bad_request", "Missing or invalid userId query parameter", 400);
  }

  try {
    const velocityState = await doBudgetGetVelocityState(env, userId);

    emitMetric("velocity_state_lookup", {
      userId,
      count: velocityState.length,
      status: "ok",
    });

    return Response.json({ velocityState });
  } catch (err) {
    console.error("[internal] Velocity state lookup failed:", err);

    emitMetric("velocity_state_lookup", {
      userId,
      status: "error",
    });

    return errorResponse("internal_error", "Velocity state lookup failed", 500);
  }
}
