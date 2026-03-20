import { waitUntil } from "cloudflare:workers";
import type { Redis } from "@upstash/redis/cloudflare";
import type { RequestContext } from "../lib/context.js";
import { errorResponse } from "../lib/errors.js";
import { buildUpstreamHeaders, buildClientHeaders } from "../lib/headers.js";
import { ensureStreamOptions, extractModelFromBody } from "../lib/request-utils.js";
import { createSSEParser } from "../lib/sse-parser.js";
import { calculateOpenAICost } from "../lib/cost-calculator.js";
import { isKnownModel } from "@nullspend/cost-engine";
import { logCostEvent } from "../lib/cost-logger.js";
import { OPENAI_BASE_URL } from "../lib/constants.js";
import type { BudgetEntity } from "../lib/budget-do-lookup.js";
import { estimateMaxCost } from "../lib/cost-estimator.js";
import { checkBudget, reconcileBudgetQueued, getReconcileQueue } from "../lib/budget-orchestrator.js";
import { sanitizeUpstreamError } from "../lib/sanitize-upstream-error.js";
import { isAllowedUpstream } from "../lib/upstream-allowlist.js";
import { stripNsPrefix } from "../lib/validation.js";
import { emitMetric } from "../lib/metrics.js";
import { getWebhookEndpoints, getWebhookEndpointsWithSecrets } from "../lib/webhook-cache.js";
import { buildCostEventPayload, buildBudgetExceededPayload, buildVelocityExceededPayload, CURRENT_API_VERSION } from "../lib/webhook-events.js";
import { dispatchToEndpoints } from "../lib/webhook-dispatch.js";
import { detectThresholdCrossings } from "../lib/webhook-thresholds.js";
import { expireRotatedSecrets } from "../lib/webhook-expiry.js";

export async function handleChatCompletions(
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

  // --- Upstream resolution ---
  const upstreamHeader = request.headers.get("x-nullspend-upstream");
  let resolvedUpstream = OPENAI_BASE_URL;

  if (upstreamHeader) {
    if (!isAllowedUpstream(upstreamHeader)) {
      return errorResponse(
        "invalid_upstream",
        "The specified upstream URL is not supported",
        400,
      );
    }
    resolvedUpstream = upstreamHeader.replace(/\/+$/, "");
  }

  if (!upstreamHeader && !isKnownModel("openai", requestModel)) {
    return errorResponse("invalid_model", `Model "${requestModel}" is not in the allowed model list`, 400);
  }

  const toolDefinitionTokens = Array.isArray(ctx.body.tools) && ctx.body.tools.length > 0
    ? Math.ceil(JSON.stringify(ctx.body.tools).length / 4)
    : 0;

  const isStreaming = ctx.body.stream === true;

  if (isStreaming) {
    ensureStreamOptions(ctx.body);
  }

  // --- Budget enforcement ---
  const estimate = estimateMaxCost(requestModel, ctx.body);

  let reservationId: string | null = null;
  let budgetEntities: BudgetEntity[] = [];

  try {
    const outcome = await checkBudget(env, ctx, estimate);

    // Velocity denial — separate from budget exhaustion
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
                model: requestModel,
                provider: "openai",
              }, ctx.auth.apiVersion);
              await dispatchToEndpoints(ctx.webhookDispatcher!, endpoints, event);
            }
          } catch (err) {
            console.error("[openai-route] Velocity webhook dispatch failed:", err);
          }
        })());
      }
      return new Response(
        JSON.stringify({
          error: {
            code: "velocity_exceeded",
            message: "Request blocked: spending rate exceeds velocity limit. Retry after cooldown.",
            details: outcome.velocityDetails ?? null,
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(outcome.retryAfterSeconds ?? 60),
          },
        },
      );
    }

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
                provider: "openai",
              });
              await dispatchToEndpoints(ctx.webhookDispatcher!, endpoints, event);
            }
          } catch (err) {
            console.error("[openai-route] Budget webhook dispatch failed:", err);
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
  const upstreamHeaders = buildUpstreamHeaders(request);
  const startTime = performance.now();
  const UPSTREAM_TIMEOUT_MS = 120_000;

  // Fix 11: wrap all post-reservation code in try/catch to ensure cleanup
  try {
    const upstreamResponse = await fetch(`${resolvedUpstream}/v1/chat/completions`, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(ctx.body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const upstreamDurationMs = Math.round(performance.now() - startTime);

    const enrichment: EnrichmentFields = {
      upstreamDurationMs,
      sessionId: ctx.sessionId,
      toolDefinitionTokens,
      tags: ctx.tags,
    };

    if (!upstreamResponse.ok) {
      // Fix 6: reconcile with actualCost=0 on upstream error
      if (reservationId) {
        waitUntil(
          reconcileBudgetQueued(getReconcileQueue(env), env, ctx.auth.userId, reservationId, 0, budgetEntities, ctx.connectionString),
        );
      }
      const clientHeaders = buildClientHeaders(upstreamResponse, ctx.resolvedApiVersion);
      const sanitizedBody = await sanitizeUpstreamError(upstreamResponse, "openai");
      clientHeaders.set("content-type", "application/json");
      return new Response(sanitizedBody, {
        status: upstreamResponse.status,
        headers: clientHeaders,
      });
    }

    const requestId =
      upstreamResponse.headers.get("x-request-id") ?? crypto.randomUUID();
    const clientHeaders = buildClientHeaders(upstreamResponse, ctx.resolvedApiVersion);

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
    // Fix 11: clean up reservation on fetch timeout or unexpected error
    if (reservationId) {
      waitUntil(
        reconcileBudgetQueued(getReconcileQueue(env), env, ctx.auth.userId, reservationId, 0, budgetEntities, ctx.connectionString),
      );
    }
    throw err;
  }
}

type Attribution = { userId: string | null; apiKeyId: string | null; actionId: string | null };

interface EnrichmentFields {
  upstreamDurationMs: number;
  sessionId: string | null;
  toolDefinitionTokens: number;
  tags: Record<string, string>;
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

  const { readable, resultPromise } = createSSEParser(upstreamBody);

  waitUntil(
    resultPromise.then(async (result) => {
      try {
        const durationMs = Math.round(performance.now() - startTime);

        if (!result?.usage) {
          // Stream cancelled by client — reconcile with pre-request estimate
          // to prevent cost evasion. Slightly overcharges but prevents free-riding.
          const reconcileCost = result?.cancelled ? estimate : 0;
          if (result?.cancelled) {
            emitMetric("stream_cancelled", { model: requestModel, estimate });
          }
          console.warn(
            "[openai-route] Streaming response completed without usage data —" +
              " cost event not recorded.",
            { requestId, model: requestModel, durationMs, cancelled: result?.cancelled ?? false },
          );
          if (reservationId) {
            await reconcileBudgetQueued(
              getReconcileQueue(env), env, ctx.auth.userId, reservationId, reconcileCost, budgetEntities, connectionString,
            );
          }
          return;
        }

        const costEvent = calculateOpenAICost(
          requestModel,
          result.model,
          result.usage,
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
            getReconcileQueue(env), env, ctx.auth.userId, reservationId, costEvent.costMicrodollars,
            budgetEntities, connectionString,
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
              for (const ep of endpoints) {
                const whEvent = buildCostEventPayload(webhookData, ep.apiVersion);
                await ctx.webhookDispatcher.dispatch(ep, whEvent);
              }

              if (budgetEntities.length > 0) {
                const epVersion = endpoints[0]?.apiVersion ?? CURRENT_API_VERSION;
                const thresholdEvents = detectThresholdCrossings(budgetEntities, costEvent.costMicrodollars, requestId, epVersion);
                for (const te of thresholdEvents) {
                  await dispatchToEndpoints(ctx.webhookDispatcher, endpoints, te);
                }
              }
              expireRotatedSecrets(connectionString, endpoints).catch(() => {});
            }
          }
        } catch (err) {
          console.error("[openai-route] Webhook dispatch failed:", err);
        }
      } catch (err) {
        console.error("[openai-route] Failed to process streaming cost event:", err);
        // Last-resort: try to reconcile with 0 on unexpected error
        if (reservationId) {
          try {
            await reconcileBudgetQueued(
              getReconcileQueue(env), env, ctx.auth.userId, reservationId, 0, budgetEntities, connectionString,
            );
          } catch { /* already logged inside reconcileBudget */ }
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
    const responseModel = parsed.model ?? null;
    const usage = parsed.usage;

    let toolCallsRequested: { name: string; id: string }[] | null = null;
    try {
      toolCallsRequested = parsed.choices?.[0]?.message?.tool_calls?.map(
        (tc: { id: string; function: { name: string } }) => ({
          name: tc.function.name,
          id: tc.id,
        })
      ) ?? null;
    } catch { /* malformed tool_calls — proceed without */ }

    if (usage) {
      const costEvent = calculateOpenAICost(
        requestModel,
        responseModel,
        usage,
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
            getReconcileQueue(env), env, ctx.auth.userId, reservationId, costEvent.costMicrodollars,
            budgetEntities, connectionString,
          ),
        );
      }

      // Webhook dispatch (separate waitUntil — independent of log/reconcile)
      if (ctx.webhookDispatcher && ctx.auth.hasWebhooks && redis) {
        waitUntil((async () => {
          try {
            const cached = await getWebhookEndpoints(redis, connectionString, ctx.auth.userId, env.CACHE_KV);
            if (cached.length > 0) {
              const endpoints = await getWebhookEndpointsWithSecrets(connectionString, ctx.auth.userId);
              const webhookData = { ...costEvent, ...enrichment, toolCallsRequested, createdAt: new Date().toISOString(), source: "proxy" as const };
              for (const ep of endpoints) {
                const whEvent = buildCostEventPayload(webhookData, ep.apiVersion);
                await ctx.webhookDispatcher!.dispatch(ep, whEvent);
              }

              if (budgetEntities.length > 0) {
                const epVersion = endpoints[0]?.apiVersion ?? CURRENT_API_VERSION;
                const thresholdEvents = detectThresholdCrossings(budgetEntities, costEvent.costMicrodollars, requestId, epVersion);
                for (const te of thresholdEvents) {
                  await dispatchToEndpoints(ctx.webhookDispatcher!, endpoints, te);
                }
              }
              expireRotatedSecrets(connectionString, endpoints).catch(() => {});
            }
          } catch (err) {
            console.error("[openai-route] Webhook dispatch failed:", err);
          }
        })());
      }
    } else if (reservationId) {
      // No usage in parsed response — reconcile with 0
      waitUntil(
        reconcileBudgetQueued(getReconcileQueue(env), env, ctx.auth.userId, reservationId, 0, budgetEntities, connectionString),
      );
    }
  } catch {
    console.error("[openai-route] Failed to parse non-streaming response for cost tracking");
    // Fix 6: reconcile on parse failure
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
