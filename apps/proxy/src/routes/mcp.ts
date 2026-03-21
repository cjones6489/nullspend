import { waitUntil } from "cloudflare:workers";
import type { RequestContext } from "../lib/context.js";
import { errorResponse } from "../lib/errors.js";
import { lookupBudgetsForDO, type BudgetEntity } from "../lib/budget-do-lookup.js";
import { logCostEventsBatchQueued, getCostEventQueue } from "../lib/cost-event-queue.js";
import { checkBudget, reconcileBudgetQueued, getReconcileQueue } from "../lib/budget-orchestrator.js";
import { getWebhookEndpoints, getWebhookEndpointsWithSecrets } from "../lib/webhook-cache.js";
import { buildCostEventPayload, buildThinCostEventPayload, buildVelocityExceededPayload, buildVelocityRecoveredPayload, buildSessionLimitExceededPayload } from "../lib/webhook-events.js";
import { detectThresholdCrossings } from "../lib/webhook-thresholds.js";
import { dispatchToEndpoints } from "../lib/webhook-dispatch.js";
import { expireRotatedSecrets } from "../lib/webhook-expiry.js";
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
    const resp = errorResponse(
      "bad_request",
      "Body must include toolName (string), serverName (string), estimateMicrodollars (non-negative number)",
      400,
    );
    resp.headers.set("X-NullSpend-Trace-Id", ctx.traceId);
    return resp;
  }

  try {
    const outcome = await checkBudget(env, ctx, parsed.estimateMicrodollars);

    if (outcome.status === "denied" && outcome.velocityDenied) {
      if (ctx.webhookDispatcher && ctx.auth.hasWebhooks && ctx.redis) {
        waitUntil((async () => {
          try {
            const cached = await getWebhookEndpoints(ctx.redis!, ctx.connectionString, ctx.auth.userId, env.CACHE_KV);
            if (cached.length > 0) {
              const endpoints = await getWebhookEndpointsWithSecrets(ctx.connectionString, ctx.auth.userId);
              const event = buildVelocityExceededPayload({
                budgetEntityType: outcome.deniedEntityType ?? "unknown",
                budgetEntityId: outcome.deniedEntityId ?? "unknown",
                velocityLimitMicrodollars: outcome.velocityDetails?.limitMicrodollars ?? 0,
                velocityWindowSeconds: outcome.velocityDetails?.windowSeconds ?? 60,
                velocityCurrentMicrodollars: outcome.velocityDetails?.currentMicrodollars ?? 0,
                cooldownSeconds: outcome.retryAfterSeconds ?? 60,
                model: `${parsed.serverName}/${parsed.toolName}`,
                provider: "mcp",
              }, ctx.auth.apiVersion);
              await dispatchToEndpoints(ctx.webhookDispatcher!, endpoints, event);
            }
          } catch (err) {
            console.error("[mcp-route] Velocity webhook dispatch failed:", err);
          }
        })());
      }
      return Response.json({
        allowed: false,
        denied: true,
        reason: "velocity_exceeded",
        retryAfterSeconds: outcome.retryAfterSeconds ?? 60,
        velocityDetails: outcome.velocityDetails ?? null,
        traceId: ctx.traceId,
      }, {
        status: 429,
        headers: {
          "NullSpend-Version": ctx.resolvedApiVersion,
          "Retry-After": String(outcome.retryAfterSeconds ?? 60),
          "X-NullSpend-Trace-Id": ctx.traceId,
        },
      });
    }

    // Session limit denial
    if (outcome.status === "denied" && outcome.sessionLimitDenied) {
      if (ctx.webhookDispatcher && ctx.auth.hasWebhooks && ctx.redis) {
        waitUntil((async () => {
          try {
            const cached = await getWebhookEndpoints(ctx.redis!, ctx.connectionString, ctx.auth.userId, env.CACHE_KV);
            if (cached.length > 0) {
              const endpoints = await getWebhookEndpointsWithSecrets(ctx.connectionString, ctx.auth.userId);
              const event = buildSessionLimitExceededPayload({
                budgetEntityType: outcome.deniedEntityType ?? "unknown",
                budgetEntityId: outcome.deniedEntityId ?? "unknown",
                sessionId: outcome.sessionId ?? "unknown",
                sessionSpendMicrodollars: outcome.sessionSpend ?? 0,
                sessionLimitMicrodollars: outcome.sessionLimit ?? 0,
                model: `${parsed.serverName}/${parsed.toolName}`,
                provider: "mcp",
              }, ctx.auth.apiVersion);
              await dispatchToEndpoints(ctx.webhookDispatcher!, endpoints, event);
            }
          } catch (err) {
            console.error("[mcp-route] Session limit webhook dispatch failed:", err);
          }
        })());
      }
      return Response.json({
        allowed: false,
        denied: true,
        reason: "session_limit_exceeded",
        sessionId: outcome.sessionId ?? null,
        sessionSpendMicrodollars: outcome.sessionSpend ?? 0,
        sessionLimitMicrodollars: outcome.sessionLimit ?? 0,
        traceId: ctx.traceId,
      }, {
        status: 429,
        headers: {
          "NullSpend-Version": ctx.resolvedApiVersion,
          "X-NullSpend-Trace-Id": ctx.traceId,
        },
      });
    }

    if (outcome.status === "denied") {
      return Response.json({
        allowed: false,
        denied: true,
        remaining: outcome.remaining,
        traceId: ctx.traceId,
      }, {
        headers: {
          "NullSpend-Version": ctx.resolvedApiVersion,
          "X-NullSpend-Trace-Id": ctx.traceId,
        },
      });
    }

    // Velocity recovery webhook (fires on approved requests where circuit breaker just cleared)
    if (outcome.velocityRecovered?.length && ctx.webhookDispatcher && ctx.auth.hasWebhooks && ctx.redis) {
      waitUntil((async () => {
        try {
          const cached = await getWebhookEndpoints(ctx.redis!, ctx.connectionString, ctx.auth.userId, env.CACHE_KV);
          if (cached.length > 0) {
            const endpoints = await getWebhookEndpointsWithSecrets(ctx.connectionString, ctx.auth.userId);
            for (const recovered of outcome.velocityRecovered!) {
              const event = buildVelocityRecoveredPayload({
                budgetEntityType: recovered.entityType,
                budgetEntityId: recovered.entityId,
                velocityLimitMicrodollars: recovered.velocityLimitMicrodollars,
                velocityWindowSeconds: recovered.velocityWindowSeconds,
                velocityCooldownSeconds: recovered.velocityCooldownSeconds,
              }, ctx.auth.apiVersion);
              await dispatchToEndpoints(ctx.webhookDispatcher!, endpoints, event);
            }
          }
        } catch (err) {
          console.error("[mcp-route] Velocity recovery webhook dispatch failed:", err);
        }
      })());
    }

    return Response.json({
      allowed: true,
      reservationId: outcome.reservationId,
      traceId: ctx.traceId,
    }, {
      headers: {
        "NullSpend-Version": ctx.resolvedApiVersion,
        "X-NullSpend-Trace-Id": ctx.traceId,
      },
    });
  } catch {
    const budgetUnavailResp = errorResponse("budget_unavailable", "Budget service unavailable", 503);
    budgetUnavailResp.headers.set("X-NullSpend-Trace-Id", ctx.traceId);
    return budgetUnavailResp;
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
    const resp = errorResponse(
      "bad_request",
      "Body must include events array (1-50 items) with toolName, serverName, durationMs, costMicrodollars, status",
      400,
    );
    resp.headers.set("X-NullSpend-Trace-Id", ctx.traceId);
    return resp;
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
        traceId: ctx.traceId,
        tags: ctx.tags,
        source: "mcp" as const,
      }));

      // Phase 2: Single batch INSERT (never throws — errors logged internally)
      try {
        await logCostEventsBatchQueued(getCostEventQueue(env), ctx.connectionString, costEventRows);
      } catch (err) {
        console.error("[mcp-events] Failed to batch-insert cost events:", err);
      }

      // Phase 3: Budget lookup + reconcile reservations
      // Hoisted so budgetEntities are available for both reconciliation and threshold detection.
      let budgetEntities: BudgetEntity[] = [];
      const eventsWithReservations = events.filter((e) => e.reservationId);
      const needsBudgetLookup = eventsWithReservations.length > 0 || (ctx.webhookDispatcher && ctx.auth.hasWebhooks);
      if (needsBudgetLookup) {
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
            thresholdPercentages: e.thresholdPercentages ?? [50, 80, 90, 95],
            sessionLimit: e.sessionLimit ?? null,
          }));
        } catch {
          // best-effort
        }
      }

      if (budgetEntities.length > 0 && eventsWithReservations.length > 0) {
        for (const event of eventsWithReservations) {
          try {
            await reconcileBudgetQueued(getReconcileQueue(env), env, ctx.auth.userId, event.reservationId!, event.costMicrodollars, budgetEntities, ctx.connectionString);
          } catch (err) {
            console.error("[mcp-events] Failed to reconcile reservation:", err);
          }
        }
      }

      // Phase 4: Webhook dispatch (one per cost event per endpoint, single secrets fetch)
      if (ctx.webhookDispatcher && ctx.auth.hasWebhooks) {
        try {
          const redis = ctx.redis;
          if (redis) {
            const cached = await getWebhookEndpoints(redis, ctx.connectionString, ctx.auth.userId, env.CACHE_KV);
            if (cached.length > 0) {
              const endpoints = await getWebhookEndpointsWithSecrets(ctx.connectionString, ctx.auth.userId);
              for (const row of costEventRows) {
                for (const ep of endpoints) {
                  if ((ep.payloadMode ?? "full") === "thin") {
                    await ctx.webhookDispatcher!.dispatch(ep, buildThinCostEventPayload(row.requestId, row.provider, ep.apiVersion));
                  } else {
                    await ctx.webhookDispatcher!.dispatch(ep, buildCostEventPayload({ ...row, createdAt: new Date().toISOString() }, ep.apiVersion));
                  }
                }
              }

              // Threshold detection (aligned with OpenAI/Anthropic routes)
              if (budgetEntities.length > 0) {
                const epVersion = endpoints[0]?.apiVersion ?? ctx.auth.apiVersion;
                const totalCost = costEventRows.reduce((sum, r) => sum + r.costMicrodollars, 0);
                if (totalCost > 0) {
                  const thresholdEvents = detectThresholdCrossings(budgetEntities, totalCost, costEventRows[0].requestId, epVersion);
                  for (const te of thresholdEvents) {
                    await dispatchToEndpoints(ctx.webhookDispatcher!, endpoints, te);
                  }
                }
              }

              expireRotatedSecrets(ctx.connectionString, endpoints).catch(() => {});
            }
          }
        } catch (err) {
          console.error("[mcp-events] Webhook dispatch failed:", err);
        }
      }
    })(),
  );

  return Response.json({ accepted }, {
    headers: {
      "NullSpend-Version": ctx.resolvedApiVersion,
      "X-NullSpend-Trace-Id": ctx.traceId,
    },
  });
}
