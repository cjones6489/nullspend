import { doBudgetRemove, doBudgetResetSpend } from "../lib/budget-do-client.js";
import { invalidateDoLookupCacheForUser } from "../lib/budget-orchestrator.js";
import { emitMetric } from "../lib/metrics.js";

interface InvalidationBody {
  action: "remove" | "reset_spend";
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

function parseBody(raw: unknown): InvalidationBody | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  if (obj.action !== "remove" && obj.action !== "reset_spend") return null;
  if (typeof obj.userId !== "string" || !obj.userId) return null;
  if (typeof obj.entityType !== "string" || !obj.entityType) return null;
  if (typeof obj.entityId !== "string" || !obj.entityId) return null;

  return {
    action: obj.action,
    userId: obj.userId,
    entityType: obj.entityType,
    entityId: obj.entityId,
  };
}

export async function handleBudgetInvalidation(
  request: Request,
  env: Env,
): Promise<Response> {
  // Validate INTERNAL_SECRET is configured
  if (!env.INTERNAL_SECRET) {
    console.error("[internal] INTERNAL_SECRET not configured");
    return Response.json({ error: "internal_error", message: "Server misconfigured" }, { status: 500 });
  }

  // Auth: timing-safe comparison of Bearer token
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return Response.json({ error: "unauthorized", message: "Missing or malformed Authorization header" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  if (!timingSafeStringEqual(token, env.INTERNAL_SECRET)) {
    return Response.json({ error: "unauthorized", message: "Invalid token" }, { status: 401 });
  }

  // Parse and validate body
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "bad_request", message: "Invalid JSON body" }, { status: 400 });
  }

  const body = parseBody(raw);
  if (!body) {
    return Response.json(
      { error: "bad_request", message: "Missing or invalid fields: action (remove|reset_spend), userId, entityType, entityId" },
      { status: 400 },
    );
  }

  // Execute
  try {
    if (body.action === "remove") {
      await doBudgetRemove(env, body.userId, body.entityType, body.entityId);
    } else {
      await doBudgetResetSpend(env, body.userId, body.entityType, body.entityId);
    }

    invalidateDoLookupCacheForUser(body.userId);

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

    return Response.json({ error: "internal_error", message: "Invalidation failed" }, { status: 500 });
  }
}
