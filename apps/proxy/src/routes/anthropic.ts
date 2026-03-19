import { waitUntil } from "cloudflare:workers";
import type { Redis } from "@upstash/redis/cloudflare";
import type { RequestContext } from "../lib/context.js";
import { errorResponse } from "../lib/errors.js";
import {
  buildAnthropicUpstreamHeaders,
  buildAnthropicClientHeaders,
} from "../lib/anthropic-headers.js";
import { extractModelFromBody } from "../lib/request-utils.js";
import { createAnthropicSSEParser } from "../lib/anthropic-sse-parser.js";
import { calculateAnthropicCost } from "../lib/anthropic-cost-calculator.js";
import type { AnthropicCacheCreationDetail } from "../lib/anthropic-types.js";
import { isKnownModel } from "@nullspend/cost-engine";
import { logCostEvent } from "../lib/cost-logger.js";
import { ANTHROPIC_BASE_URL } from "../lib/constants.js";
import type { BudgetEntity } from "../lib/budget-do-lookup.js";
import { estimateAnthropicMaxCost } from "../lib/anthropic-cost-estimator.js";
import { checkBudget, reconcileBudgetQueued, getReconcileQueue } from "../lib/budget-orchestrator.js";
import { sanitizeUpstreamError } from "../lib/sanitize-upstream-error.js";
import { stripNsPrefix } from "../lib/validation.js";
import { emitMetric } from "../lib/metrics.js";
import { getWebhookEndpoints, getWebhookEndpointsWithSecrets } from "../lib/webhook-cache.js";
import { buildCostEventPayload, buildBudgetExceededPayload } from "../lib/webhook-events.js";
import { dispatchToEndpoints } from "../lib/webhook-dispatch.js";
import { detectThresholdCrossings } from "../lib/webhook-thresholds.js";

const UPSTREAM_TIMEOUT_MS = 120_000;

type Attribution = {
  userId: string | null;
  apiKeyId: string | null;
  actionId: string | null;
};

interface EnrichmentFields {
  upstreamDurationMs: number;
  sessionId: string | null;
  toolDefinitionTokens: number;
}

export async function handleAnthropicMessages(
  request: Request,
  env: Env,
  ctx: RequestContext,
): Promise<Response> {
  const requestModel = extractModelFromBody(ctx.body);

  const attribution: Attribution = {
    userId: ctx.auth.userId,
    apiKeyId: ctx.auth.keyId,
    actionId: stripNsPrefix("ns_act_", request.headers.get("x-nullspend-action-id")),
  };

  if (!isKnownModel("anthropic", requestModel)) {
    return errorResponse("invalid_model", `Model "${requestModel}" is not in the allowed model list`, 400);
  }

  const toolDefinitionTokens = Array.isArray(ctx.body.tools) && ctx.body.tools.length > 0
    ? Math.ceil(JSON.stringify(ctx.body.tools).length / 4)
    : 0;

  const isStreaming = ctx.body.stream === true;

  // --- Budget enforcement ---
  const estimate = estimateAnthropicMaxCost(requestModel, ctx.body);

  let reservationId: string | null = null;
  let budgetEntities: BudgetEntity[] = [];

  try {
    const outcome = await checkBudget(env, ctx, estimate);

    if (outcome.status === "denied") {
      if (ctx.webhookDispatcher && ctx.auth.hasWebhooks && ctx.redis) {
        waitUntil((async () => {
          try {
            const cached = await getWebhookEndpoints(ctx.redis!, ctx.connectionString, ctx.auth.userId, env.CACHE_KV);
            if (cached.length > 0) {
              const endpoints = await getWebhookEndpointsWithSecrets(ctx.connectionString, ctx.auth.userId);
              const event = buildBudgetExceededPayload({
                budgetEntityType: outcome.deniedEntityType ?? budgetEntities[0]?.entityType ?? "unknown",
                budgetEntityId: outcome.deniedEntityId ?? budgetEntities[0]?.entityId ?? "unknown",
                budgetLimitMicrodollars: outcome.maxBudget ?? 0,
                budgetSpendMicrodollars: (outcome.spend ?? 0) + (outcome.reserved ?? 0),
                estimatedRequestCostMicrodollars: estimate,
                model: requestModel,
                provider: "anthropic",
              });
              await dispatchToEndpoints(ctx.webhookDispatcher!, endpoints, event);
            }
          } catch (err) {
            console.error("[anthropic-route] Budget webhook dispatch failed:", err);
          }
        })());
      }
      return errorResponse("budget_exceeded", "Request blocked: estimated cost exceeds remaining budget", 429);
    }

    reservationId = outcome.reservationId;
    budgetEntities = outcome.budgetEntities;
  } catch {
    return errorResponse("budget_unavailable", "Budget service unavailable", 503);
  }

  // --- Forward to upstream ---
  const upstreamHeaders = buildAnthropicUpstreamHeaders(request);
  const startTime = performance.now();

  try {
    const upstreamResponse = await fetch(
      `${ANTHROPIC_BASE_URL}/v1/messages`,
      {
        method: "POST",
        headers: upstreamHeaders,
        body: JSON.stringify(ctx.body),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    const upstreamDurationMs = Math.round(performance.now() - startTime);

    const enrichment: EnrichmentFields = {
      upstreamDurationMs,
      sessionId: ctx.sessionId,
      toolDefinitionTokens,
    };

    if (!upstreamResponse.ok) {
      if (reservationId) {
        waitUntil(
          reconcileBudgetQueued(getReconcileQueue(env), env, ctx.auth.userId, reservationId, 0, budgetEntities, ctx.connectionString),
        );
      }
      const clientHeaders = buildAnthropicClientHeaders(upstreamResponse);
      const sanitizedBody = await sanitizeUpstreamError(upstreamResponse, "anthropic");
      clientHeaders.set("content-type", "application/json");
      return new Response(sanitizedBody, {
        status: upstreamResponse.status,
        headers: clientHeaders,
      });
    }

    const requestId =
      upstreamResponse.headers.get("request-id") ?? crypto.randomUUID();
    const clientHeaders = buildAnthropicClientHeaders(upstreamResponse);

    if (isStreaming) {
      return handleStreaming(
        upstreamResponse,
        clientHeaders,
        requestModel,
        requestId,
        startTime,
        env,
        attribution,
        ctx.redis,
        reservationId,
        budgetEntities,
        ctx.connectionString,
        enrichment,
        ctx,
        estimate,
      );
    }

    return await handleNonStreaming(
      upstreamResponse,
      clientHeaders,
      requestModel,
      requestId,
      startTime,
      env,
      attribution,
      ctx.redis,
      reservationId,
      budgetEntities,
      ctx.connectionString,
      enrichment,
      ctx,
    );
  } catch (err) {
    if (reservationId) {
      waitUntil(
        reconcileBudgetQueued(getReconcileQueue(env), env, ctx.auth.userId, reservationId, 0, budgetEntities, ctx.connectionString),
      );
    }
    throw err;
  }
}

function handleStreaming(
  upstreamResponse: Response,
  clientHeaders: Headers,
  requestModel: string,
  requestId: string,
  startTime: number,
  env: Env,
  attribution: Attribution,
  redis: Redis | null,
  reservationId: string | null,
  budgetEntities: BudgetEntity[],
  connectionString: string,
  enrichment: EnrichmentFields,
  ctx: RequestContext,
  estimate: number,
): Response {
  const upstreamBody = upstreamResponse.body;
  if (!upstreamBody) {
    if (reservationId) {
      waitUntil(
        reconcileBudgetQueued(getReconcileQueue(env), env, ctx.auth.userId, reservationId, 0, budgetEntities, connectionString),
      );
    }
    return errorResponse("upstream_error", "No response body from upstream", 502);
  }

  const { readable, resultPromise } = createAnthropicSSEParser(upstreamBody);

  waitUntil(
    resultPromise.then(async (result) => {
      try {
        const durationMs = Math.round(performance.now() - startTime);

        if (!result?.usage) {
          // Stream cancelled by client — reconcile with pre-request estimate
          // to prevent cost evasion.
          const reconcileCost = result?.cancelled ? estimate : 0;
          if (result?.cancelled) {
            emitMetric("stream_cancelled", { model: requestModel, estimate });
          }
          console.warn(
            "[anthropic-route] Streaming response completed without usage" +
              " data — cost event not recorded.",
            { requestId, model: requestModel, durationMs, cancelled: result?.cancelled ?? false },
          );
          if (reservationId) {
            await reconcileBudgetQueued(
              getReconcileQueue(env), env, ctx.auth.userId, reservationId, reconcileCost, budgetEntities, connectionString,
            );
          }
          return;
        }

        const costEvent = calculateAnthropicCost(
          requestModel,
          result.model,
          result.usage,
          result.cacheCreationDetail,
          requestId,
          durationMs,
          attribution,
        );

        await logCostEvent(connectionString, {
          ...costEvent,
          ...enrichment,
          toolCallsRequested: result.toolCalls,
          source: "proxy" as const,
        });

        if (reservationId) {
          await reconcileBudgetQueued(
            getReconcileQueue(env), env, ctx.auth.userId, reservationId, costEvent.costMicrodollars, budgetEntities, connectionString,
          );
        }

        // --- Webhook dispatch (nested try/catch — costEvent must stay in scope,
        //     but errors here must NOT trigger the outer catch's reconciliation fallback) ---
        try {
          if (ctx.webhookDispatcher && ctx.auth.hasWebhooks && redis) {
            const cached = await getWebhookEndpoints(redis, connectionString, ctx.auth.userId, env.CACHE_KV);
            if (cached.length > 0) {
              const endpoints = await getWebhookEndpointsWithSecrets(connectionString, ctx.auth.userId);
              const webhookData = {
                ...costEvent,
                ...enrichment,
                toolCallsRequested: result.toolCalls,
                createdAt: new Date().toISOString(),
                source: "proxy" as const,
              };
              const whEvent = buildCostEventPayload(webhookData);
              await dispatchToEndpoints(ctx.webhookDispatcher, endpoints, whEvent);

              if (budgetEntities.length > 0) {
                const thresholdEvents = detectThresholdCrossings(budgetEntities, costEvent.costMicrodollars, requestId);
                for (const te of thresholdEvents) {
                  await dispatchToEndpoints(ctx.webhookDispatcher, endpoints, te);
                }
              }
            }
          }
        } catch (err) {
          console.error("[anthropic-route] Webhook dispatch failed:", err);
        }
      } catch (err) {
        console.error(
          "[anthropic-route] Failed to process streaming cost event:",
          err,
        );
        if (reservationId) {
          try {
            await reconcileBudgetQueued(
              getReconcileQueue(env), env, ctx.auth.userId, reservationId, 0, budgetEntities, connectionString,
            );
          } catch { /* already logged inside reconcileBudgetQueued */ }
        }
      }
    }),
  );

  clientHeaders.set("cache-control", "no-cache, no-transform");
  clientHeaders.set("x-accel-buffering", "no");
  clientHeaders.set("connection", "keep-alive");

  return new Response(readable, {
    status: upstreamResponse.status,
    headers: clientHeaders,
  });
}

async function handleNonStreaming(
  upstreamResponse: Response,
  clientHeaders: Headers,
  requestModel: string,
  requestId: string,
  startTime: number,
  env: Env,
  attribution: Attribution,
  redis: Redis | null,
  reservationId: string | null,
  budgetEntities: BudgetEntity[],
  connectionString: string,
  enrichment: EnrichmentFields,
  ctx: RequestContext,
): Promise<Response> {
  const responseText = await upstreamResponse.text();
  const durationMs = Math.round(performance.now() - startTime);

  try {
    const parsed = JSON.parse(responseText);
    const responseModel: string | null = parsed.model ?? null;
    const usage = parsed.usage;

    let toolCallsRequested: { name: string; id: string }[] | null = null;
    try {
      if (Array.isArray(parsed.content)) {
        const toolUseBlocks = parsed.content
          .filter((b: { type: string }) => b.type === "tool_use");
        if (toolUseBlocks.length > 0) {
          toolCallsRequested = toolUseBlocks.map(
            (b: { id: string; name: string }) => ({ name: b.name, id: b.id }),
          );
        }
      }
    } catch { /* malformed content blocks — proceed without */ }

    if (usage) {
      const cacheCreationDetail: AnthropicCacheCreationDetail | null =
        usage.cache_creation &&
        typeof usage.cache_creation === "object"
          ? usage.cache_creation
          : null;

      const costEvent = calculateAnthropicCost(
        requestModel,
        responseModel,
        usage,
        cacheCreationDetail,
        requestId,
        durationMs,
        attribution,
      );

      waitUntil(logCostEvent(connectionString, {
        ...costEvent,
        ...enrichment,
        toolCallsRequested,
        source: "proxy" as const,
      }));

      if (reservationId) {
        waitUntil(
          reconcileBudgetQueued(
            getReconcileQueue(env), env, ctx.auth.userId, reservationId, costEvent.costMicrodollars, budgetEntities, connectionString,
          ),
        );
      }

      // Webhook dispatch (separate waitUntil)
      if (ctx.webhookDispatcher && ctx.auth.hasWebhooks && redis) {
        waitUntil((async () => {
          try {
            const cached = await getWebhookEndpoints(redis, connectionString, ctx.auth.userId, env.CACHE_KV);
            if (cached.length > 0) {
              const endpoints = await getWebhookEndpointsWithSecrets(connectionString, ctx.auth.userId);
              const webhookData = { ...costEvent, ...enrichment, toolCallsRequested, createdAt: new Date().toISOString(), source: "proxy" as const };
              const whEvent = buildCostEventPayload(webhookData);
              await dispatchToEndpoints(ctx.webhookDispatcher!, endpoints, whEvent);

              if (budgetEntities.length > 0) {
                const thresholdEvents = detectThresholdCrossings(budgetEntities, costEvent.costMicrodollars, requestId);
                for (const te of thresholdEvents) {
                  await dispatchToEndpoints(ctx.webhookDispatcher!, endpoints, te);
                }
              }
            }
          } catch (err) {
            console.error("[anthropic-route] Webhook dispatch failed:", err);
          }
        })());
      }
    } else if (reservationId) {
      waitUntil(
        reconcileBudgetQueued(getReconcileQueue(env), env, ctx.auth.userId, reservationId, 0, budgetEntities, connectionString),
      );
    }
  } catch {
    console.error(
      "[anthropic-route] Failed to parse non-streaming response for cost tracking",
    );
    if (reservationId) {
      waitUntil(
        reconcileBudgetQueued(getReconcileQueue(env), env, ctx.auth.userId, reservationId, 0, budgetEntities, connectionString),
      );
    }
  }

  return new Response(responseText, {
    status: upstreamResponse.status,
    headers: clientHeaders,
  });
}
