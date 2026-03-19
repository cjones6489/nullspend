import { invalidateAuthCacheForUser } from "../lib/api-key-auth.js";
import { doBudgetRemove, doBudgetResetSpend, doBudgetPopulate } from "../lib/budget-do-client.js";
import { lookupBudgetsForDO } from "../lib/budget-do-lookup.js";
import { invalidateDoLookupCacheForUser } from "../lib/budget-orchestrator.js";
import { errorResponse } from "../lib/errors.js";
import { emitMetric } from "../lib/metrics.js";

interface InvalidationBody {
  action: "remove" | "reset_spend" | "sync";
  userId: string;
  entityType: string;
  entityId: string;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  const lengthsMatch = bufA.byteLength === bufB.byteLength;
  return lengthsMatch
    ? crypto.subtle.timingSafeEqual(bufA, bufB)
    : !crypto.subtle.timingSafeEqual(bufA, bufA);
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
      // action === "sync": query Postgres for current budget state and sync to DO
      const connectionString = env.HYPERDRIVE.connectionString;
      const identity = { keyId: body.entityId, userId: body.userId };
      const entities = await lookupBudgetsForDO(connectionString, identity);
      await doBudgetPopulate(env, body.userId, entities);
    }

    invalidateDoLookupCacheForUser(body.userId);
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
