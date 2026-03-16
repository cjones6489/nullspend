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
import { checkAndReserve, type BudgetCheckResult } from "../lib/budget.js";
import { lookupBudgets, type BudgetEntity } from "../lib/budget-lookup.js";
import { estimateAnthropicMaxCost } from "../lib/anthropic-cost-estimator.js";
import { reconcileReservation } from "../lib/budget-reconcile.js";
import { sanitizeUpstreamError } from "../lib/sanitize-upstream-error.js";
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
    actionId: request.headers.get("x-nullspend-action-id"),
  };

  if (!isKnownModel("anthropic", requestModel)) {
    return errorResponse("invalid_model", `Model "${requestModel}" is not in the allowed model list`, 400);
  }

  const toolDefinitionTokens = Array.isArray(ctx.body.tools) && ctx.body.tools.length > 0
    ? Math.ceil(JSON.stringify(ctx.body.tools).length / 4)
    : 0;

  const isStreaming = ctx.body.stream === true;

  // --- Budget enforcement ---
  let reservationId: string | null = null;
  let budgetEntities: BudgetEntity[] = [];

  if (ctx.auth.hasBudgets && ctx.redis) {
    try {
      budgetEntities = await lookupBudgets(
        ctx.redis,
        ctx.connectionString,
        { keyId: ctx.auth.keyId, userId: ctx.auth.userId },
      );
    } catch {
      return errorResponse("budget_unavailable", "Budget service unavailable", 503);
    }

    if (budgetEntities.length > 0) {
      const estimate = estimateAnthropicMaxCost(requestModel, ctx.body);
      const entityKeys = budgetEntities.map((e) => e.entityKey);

      let checkResult: BudgetCheckResult;
      try {
        checkResult = await checkAndReserve(ctx.redis, entityKeys, estimate);
      } catch {
        return errorResponse("budget_unavailable", "Budget service unavailable", 503);
      }

      if (checkResult.status === "denied") {
        if (ctx.webhookDispatcher && ctx.auth.hasWebhooks && ctx.redis) {
          waitUntil((async () => {
            try {
              const cached = await getWebhookEndpoints(ctx.redis!, ctx.connectionString, ctx.auth.userId);
              if (cached.length > 0) {
                const endpoints = await getWebhookEndpointsWithSecrets(ctx.connectionString, ctx.auth.userId);
                const event = buildBudgetExceededPayload({
                  budgetEntityType: budgetEntities[0].entityType,
                  budgetEntityId: budgetEntities[0].entityId,
                  budgetLimitMicrodollars: budgetEntities[0].maxBudget,
                  budgetSpendMicrodollars: budgetEntities[0].spend + budgetEntities[0].reserved,
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

      reservationId = checkResult.reservationId;
    }
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
      if (reservationId && ctx.redis) {
        waitUntil(
          reconcileReservation(ctx.redis, reservationId, 0, budgetEntities, ctx.connectionString),
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
    if (reservationId && ctx.redis) {
      waitUntil(
        reconcileReservation(ctx.redis, reservationId, 0, budgetEntities, ctx.connectionString),
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
): Response {
  const upstreamBody = upstreamResponse.body;
  if (!upstreamBody) {
    if (reservationId && redis) {
      waitUntil(
        reconcileReservation(redis, reservationId, 0, budgetEntities, connectionString),
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
          console.warn(
            "[anthropic-route] Streaming response completed without usage" +
              " data — cost event not recorded.",
            { requestId, model: requestModel, durationMs },
          );
          if (reservationId && redis) {
            await reconcileReservation(
              redis, reservationId, 0, budgetEntities, connectionString,
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
        });

        if (reservationId && redis) {
          await reconcileReservation(
            redis, reservationId, costEvent.costMicrodollars,
            budgetEntities, connectionString,
          );
        }

        // --- Webhook dispatch (nested try/catch — costEvent must stay in scope,
        //     but errors here must NOT trigger the outer catch's reconciliation fallback) ---
        try {
          if (ctx.webhookDispatcher && ctx.auth.hasWebhooks && redis) {
            const cached = await getWebhookEndpoints(redis, connectionString, ctx.auth.userId);
            if (cached.length > 0) {
              const endpoints = await getWebhookEndpointsWithSecrets(connectionString, ctx.auth.userId);
              const webhookData = {
                ...costEvent,
                ...enrichment,
                toolCallsRequested: result.toolCalls,
                createdAt: new Date().toISOString(),
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
        if (reservationId && redis) {
          try {
            await reconcileReservation(
              redis, reservationId, 0, budgetEntities, connectionString,
            );
          } catch { /* already logged inside reconcileReservation */ }
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
      }));

      if (reservationId && redis) {
        waitUntil(
          reconcileReservation(
            redis, reservationId, costEvent.costMicrodollars,
            budgetEntities, connectionString,
          ),
        );
      }

      // Webhook dispatch (separate waitUntil)
      if (ctx.webhookDispatcher && ctx.auth.hasWebhooks && redis) {
        waitUntil((async () => {
          try {
            const cached = await getWebhookEndpoints(redis, connectionString, ctx.auth.userId);
            if (cached.length > 0) {
              const endpoints = await getWebhookEndpointsWithSecrets(connectionString, ctx.auth.userId);
              const webhookData = { ...costEvent, ...enrichment, toolCallsRequested, createdAt: new Date().toISOString() };
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
    } else if (reservationId && redis) {
      waitUntil(
        reconcileReservation(redis, reservationId, 0, budgetEntities, connectionString),
      );
    }
  } catch {
    console.error(
      "[anthropic-route] Failed to parse non-streaming response for cost tracking",
    );
    if (reservationId && redis) {
      waitUntil(
        reconcileReservation(redis, reservationId, 0, budgetEntities, connectionString),
      );
    }
  }

  return new Response(responseText, {
    status: upstreamResponse.status,
    headers: clientHeaders,
  });
}
