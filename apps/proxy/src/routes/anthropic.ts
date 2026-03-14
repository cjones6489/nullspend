import { waitUntil } from "cloudflare:workers";
import { Redis } from "@upstash/redis/cloudflare";
import { validatePlatformKey, unauthorizedResponse } from "../lib/auth.js";
import {
  buildAnthropicUpstreamHeaders,
  buildAnthropicClientHeaders,
} from "../lib/anthropic-headers.js";
import { extractModelFromBody, extractAttribution } from "../lib/request-utils.js";
import { createAnthropicSSEParser } from "../lib/anthropic-sse-parser.js";
import { calculateAnthropicCost } from "../lib/anthropic-cost-calculator.js";
import type { AnthropicCacheCreationDetail } from "../lib/anthropic-types.js";
import { isKnownModel } from "@agentseam/cost-engine";
import { logCostEvent } from "../lib/cost-logger.js";
import { ANTHROPIC_BASE_URL } from "../lib/constants.js";
import { checkAndReserve, type BudgetCheckResult } from "../lib/budget.js";
import { lookupBudgets, type BudgetEntity } from "../lib/budget-lookup.js";
import { estimateAnthropicMaxCost } from "../lib/anthropic-cost-estimator.js";
import { reconcileReservation } from "../lib/budget-reconcile.js";
import { sanitizeUpstreamError } from "../lib/sanitize-upstream-error.js";

const UPSTREAM_TIMEOUT_MS = 120_000;

type Attribution = {
  userId: string | null;
  apiKeyId: string | null;
  actionId: string | null;
};

export async function handleAnthropicMessages(
  request: Request,
  env: Env,
  body: Record<string, unknown>,
): Promise<Response> {
  const isAuthed = await validatePlatformKey(
    request.headers.get("x-agentseam-auth"),
    env.PLATFORM_AUTH_KEY,
  );
  if (!isAuthed) return unauthorizedResponse();

  const requestModel = extractModelFromBody(body);
  const attribution = extractAttribution(request);

  if (!isKnownModel("anthropic", requestModel)) {
    return Response.json(
      {
        error: "invalid_model",
        message: `Model "${requestModel}" is not in the allowed model list`,
      },
      { status: 400 },
    );
  }

  const isStreaming = body.stream === true;

  // --- Budget enforcement ---
  const redis = Redis.fromEnv(env);
  const connectionString = env.HYPERDRIVE.connectionString;
  let reservationId: string | null = null;
  let budgetEntities: BudgetEntity[] = [];

  try {
    budgetEntities = await lookupBudgets(
      redis,
      connectionString,
      attribution.apiKeyId,
      attribution.userId,
    );
  } catch {
    return Response.json(
      { error: "budget_unavailable", message: "Budget service unavailable" },
      { status: 503 },
    );
  }

  if (budgetEntities.length > 0) {
    const estimate = estimateAnthropicMaxCost(requestModel, body);
    const entityKeys = budgetEntities.map((e) => e.entityKey);

    let checkResult: BudgetCheckResult;
    try {
      checkResult = await checkAndReserve(redis, entityKeys, estimate);
    } catch {
      return Response.json(
        { error: "budget_unavailable", message: "Budget service unavailable" },
        { status: 503 },
      );
    }

    if (checkResult.status === "denied") {
      return Response.json(
        {
          error: "budget_exceeded",
          message: "Request blocked: estimated cost exceeds remaining budget",
        },
        { status: 429 },
      );
    }

    reservationId = checkResult.reservationId;
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
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );

    if (!upstreamResponse.ok) {
      if (reservationId) {
        waitUntil(
          reconcileReservation(redis, reservationId, 0, budgetEntities, connectionString),
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
        redis,
        reservationId,
        budgetEntities,
        connectionString,
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
      redis,
      reservationId,
      budgetEntities,
      connectionString,
    );
  } catch (err) {
    if (reservationId) {
      waitUntil(
        reconcileReservation(redis, reservationId, 0, budgetEntities, connectionString),
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
  redis: Redis,
  reservationId: string | null,
  budgetEntities: BudgetEntity[],
  connectionString: string,
): Response {
  const upstreamBody = upstreamResponse.body;
  if (!upstreamBody) {
    if (reservationId) {
      waitUntil(
        reconcileReservation(redis, reservationId, 0, budgetEntities, connectionString),
      );
    }
    return new Response("No response body from upstream", { status: 502 });
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
          if (reservationId) {
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

        await logCostEvent(env.HYPERDRIVE.connectionString, costEvent);

        if (reservationId) {
          await reconcileReservation(
            redis, reservationId, costEvent.costMicrodollars,
            budgetEntities, connectionString,
          );
        }
      } catch (err) {
        console.error(
          "[anthropic-route] Failed to process streaming cost event:",
          err,
        );
        if (reservationId) {
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
  redis: Redis,
  reservationId: string | null,
  budgetEntities: BudgetEntity[],
  connectionString: string,
): Promise<Response> {
  const responseText = await upstreamResponse.text();
  const durationMs = Math.round(performance.now() - startTime);

  try {
    const parsed = JSON.parse(responseText);
    const responseModel: string | null = parsed.model ?? null;
    const usage = parsed.usage;

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

      waitUntil(logCostEvent(env.HYPERDRIVE.connectionString, costEvent));

      if (reservationId) {
        waitUntil(
          reconcileReservation(
            redis, reservationId, costEvent.costMicrodollars,
            budgetEntities, connectionString,
          ),
        );
      }
    } else if (reservationId) {
      waitUntil(
        reconcileReservation(redis, reservationId, 0, budgetEntities, connectionString),
      );
    }
  } catch {
    console.error(
      "[anthropic-route] Failed to parse non-streaming response for cost tracking",
    );
    if (reservationId) {
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
