import { waitUntil } from "cloudflare:workers";
import type { RequestContext } from "../lib/context.js";
import { errorResponse } from "../lib/errors.js";
import { lookupBudgetsForDO, type BudgetEntity } from "../lib/budget-do-lookup.js";
import { logCostEventsBatch } from "../lib/cost-logger.js";
import { checkBudget, reconcileBudgetQueued, getReconcileQueue } from "../lib/budget-orchestrator.js";
import { getWebhookEndpoints, getWebhookEndpointsWithSecrets } from "../lib/webhook-cache.js";
import { buildCostEventPayload } from "../lib/webhook-events.js";
import { dispatchToEndpoints } from "../lib/webhook-dispatch.js";
import { UUID_RE } from "../lib/validation.js";

// ---------------------------------------------------------------------------
// POST /v1/mcp/budget/check
// ---------------------------------------------------------------------------

interface BudgetCheckBody {
  toolName: string;
  serverName: string;
  estimateMicrodollars: number;
}

function validateBudgetCheckBody(
  body: Record<string, unknown>,
): BudgetCheckBody | null {
  if (
    typeof body.toolName !== "string" ||
    body.toolName.length === 0 ||
    typeof body.serverName !== "string" ||
    body.serverName.length === 0 ||
    typeof body.estimateMicrodollars !== "number" ||
    !Number.isFinite(body.estimateMicrodollars) ||
    body.estimateMicrodollars < 0
  ) {
    return null;
  }
  return body as unknown as BudgetCheckBody;
}

export async function handleMcpBudgetCheck(
  request: Request,
  env: Env,
  ctx: RequestContext,
): Promise<Response> {
  const parsed = validateBudgetCheckBody(ctx.body);
  if (!parsed) {
    return errorResponse(
      "bad_request",
      "Body must include toolName (string), serverName (string), estimateMicrodollars (non-negative number)",
      400,
    );
  }

  try {
    const outcome = await checkBudget(env, ctx, parsed.estimateMicrodollars);

    if (outcome.status === "denied") {
      return Response.json({
        allowed: false,
        denied: true,
        remaining: outcome.remaining,
      });
    }

    return Response.json({
      allowed: true,
      reservationId: outcome.reservationId,
    });
  } catch {
    return errorResponse("budget_unavailable", "Budget service unavailable", 503);
  }
}

// ---------------------------------------------------------------------------
// POST /v1/mcp/events
// ---------------------------------------------------------------------------

interface McpCostEvent {
  toolName: string;
  serverName: string;
  durationMs: number;
  costMicrodollars: number;
  status: string;
  reservationId?: string;
  actionId?: string;
}

function validateEvents(body: Record<string, unknown>): McpCostEvent[] | null {
  if (!Array.isArray(body.events)) return null;
  if (body.events.length === 0 || body.events.length > 50) return null;

  for (const event of body.events) {
    if (
      typeof event !== "object" ||
      event === null ||
      typeof event.toolName !== "string" ||
      event.toolName.length === 0 ||
      typeof event.serverName !== "string" ||
      event.serverName.length === 0 ||
      typeof event.durationMs !== "number" ||
      !Number.isFinite(event.durationMs) ||
      event.durationMs < 0 ||
      typeof event.costMicrodollars !== "number" ||
      !Number.isFinite(event.costMicrodollars) ||
      event.costMicrodollars < 0 ||
      typeof event.status !== "string"
    ) {
      return null;
    }
  }

  return body.events as McpCostEvent[];
}

export async function handleMcpEvents(
  request: Request,
  env: Env,
  ctx: RequestContext,
): Promise<Response> {
  const events = validateEvents(ctx.body);
  if (!events) {
    return errorResponse(
      "bad_request",
      "Body must include events array (1-50 items) with toolName, serverName, durationMs, costMicrodollars, status",
      400,
    );
  }

  const userId = ctx.auth.userId;
  const apiKeyId = ctx.auth.keyId;

  const accepted = events.length;

  waitUntil(
    (async () => {
      // Phase 1: Build all cost event rows
      const costEventRows = events.map((event) => ({
        requestId: crypto.randomUUID(),
        provider: "mcp" as const,
        model: `${event.serverName}/${event.toolName}`,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        costMicrodollars: event.costMicrodollars,
        durationMs: event.durationMs,
        userId,
        apiKeyId,
        actionId: event.actionId && UUID_RE.test(event.actionId) ? event.actionId : null,
        eventType: "tool" as const,
        toolName: event.toolName,
        toolServer: event.serverName,
        sessionId: ctx.sessionId,
        source: "mcp" as const,
      }));

      // Phase 2: Single batch INSERT (never throws — errors logged internally)
      try {
        await logCostEventsBatch(ctx.connectionString, costEventRows);
      } catch (err) {
        console.error("[mcp-events] Failed to batch-insert cost events:", err);
      }

      // Phase 3: Reconcile reservations (one budget lookup via DO)
      const eventsWithReservations = events.filter((e) => e.reservationId);
      if (eventsWithReservations.length > 0) {
        let budgetEntities: BudgetEntity[] = [];
        try {
          const doEntities = await lookupBudgetsForDO(ctx.connectionString, { keyId: apiKeyId, userId });
          budgetEntities = doEntities.map((e) => ({
            entityKey: `{budget}:${e.entityType}:${e.entityId}`,
            entityType: e.entityType,
            entityId: e.entityId,
            maxBudget: e.maxBudget,
            spend: e.spend,
            reserved: 0,
            policy: e.policy,
          }));
        } catch {
          // best-effort
        }

        if (budgetEntities.length > 0) {
          for (const event of eventsWithReservations) {
            try {
              await reconcileBudgetQueued(getReconcileQueue(env), env, ctx.auth.userId, event.reservationId!, event.costMicrodollars, budgetEntities, ctx.connectionString);
            } catch (err) {
              console.error("[mcp-events] Failed to reconcile reservation:", err);
            }
          }
        }
      }

      // Phase 4: Webhook dispatch (one per cost event, single secrets fetch)
      if (ctx.webhookDispatcher && ctx.auth.hasWebhooks) {
        try {
          const redis = ctx.redis;
          if (redis) {
            const cached = await getWebhookEndpoints(redis, ctx.connectionString, ctx.auth.userId, env.CACHE_KV);
            if (cached.length > 0) {
              const endpoints = await getWebhookEndpointsWithSecrets(ctx.connectionString, ctx.auth.userId);
              for (const row of costEventRows) {
                const whEvent = buildCostEventPayload({
                  ...row,
                  createdAt: new Date().toISOString(),
                });
                await dispatchToEndpoints(ctx.webhookDispatcher!, endpoints, whEvent);
              }
            }
          }
        } catch (err) {
          console.error("[mcp-events] Webhook dispatch failed:", err);
        }
      }
    })(),
  );

  return Response.json({ accepted });
}
