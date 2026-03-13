import { waitUntil } from "cloudflare:workers";
import { Redis } from "@upstash/redis/cloudflare";
import { validatePlatformKey, unauthorizedResponse } from "../lib/auth.js";
import { buildUpstreamHeaders, buildClientHeaders } from "../lib/headers.js";
import { ensureStreamOptions, extractModelFromBody } from "../lib/request-utils.js";
import { createSSEParser } from "../lib/sse-parser.js";
import { calculateOpenAICost } from "../lib/cost-calculator.js";
import { isKnownModel } from "@agentseam/cost-engine";
import { logCostEvent } from "../lib/cost-logger.js";
import { OPENAI_BASE_URL } from "../lib/constants.js";
import { checkAndReserve, type BudgetCheckResult } from "../lib/budget.js";
import { lookupBudgets, type BudgetEntity } from "../lib/budget-lookup.js";
import { estimateMaxCost } from "../lib/cost-estimator.js";
import { reconcileReservation } from "../lib/budget-reconcile.js";

export async function handleChatCompletions(
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
  const attribution = {
    userId: request.headers.get("x-agentseam-user-id"),
    apiKeyId: request.headers.get("x-agentseam-key-id"),
    actionId: request.headers.get("x-agentseam-action-id"),
  };

  if (!isKnownModel("openai", requestModel)) {
    return Response.json(
      { error: "invalid_model", message: `Model "${requestModel}" is not in the allowed model list` },
      { status: 400 },
    );
  }

  const isStreaming = body.stream === true;

  if (isStreaming) {
    ensureStreamOptions(body);
  }

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
    // Budget lookup failed — fail-closed (budget is a safety feature)
    return Response.json(
      { error: "budget_unavailable", message: "Budget service unavailable" },
      { status: 503 },
    );
  }

  if (budgetEntities.length > 0) {
    const estimate = estimateMaxCost(requestModel, body);
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
          details: {
            entity_key: checkResult.entityKey,
            remaining_microdollars: checkResult.remaining,
            estimated_microdollars: estimate,
            budget_limit_microdollars: checkResult.maxBudget,
            spent_microdollars: checkResult.spend,
          },
        },
        { status: 429 },
      );
    }

    reservationId = checkResult.reservationId;
  }

  // --- Forward to upstream ---
  const upstreamHeaders = buildUpstreamHeaders(request);
  const startTime = performance.now();
  const UPSTREAM_TIMEOUT_MS = 120_000;

  // Fix 11: wrap all post-reservation code in try/catch to ensure cleanup
  try {
    const upstreamResponse = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    if (!upstreamResponse.ok) {
      // Fix 6: reconcile with actualCost=0 on upstream error
      if (reservationId) {
        waitUntil(
          reconcileReservation(redis, reservationId, 0, budgetEntities, connectionString),
        );
      }
      const clientHeaders = buildClientHeaders(upstreamResponse);
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: clientHeaders,
      });
    }

    const requestId =
      upstreamResponse.headers.get("x-request-id") ?? crypto.randomUUID();
    const clientHeaders = buildClientHeaders(upstreamResponse);

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
    // Fix 11: clean up reservation on fetch timeout or unexpected error
    if (reservationId) {
      waitUntil(
        reconcileReservation(redis, reservationId, 0, budgetEntities, connectionString),
      );
    }
    throw err;
  }
}

type Attribution = { userId: string | null; apiKeyId: string | null; actionId: string | null };

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

  const { readable, resultPromise } = createSSEParser(upstreamBody);

  waitUntil(
    resultPromise.then(async (result) => {
      try {
        const durationMs = Math.round(performance.now() - startTime);

        if (!result?.usage) {
          console.warn(
            "[openai-route] Streaming response completed without usage data —" +
              " cost event not recorded.",
            { requestId, model: requestModel, durationMs },
          );
          // Fix 6: reconcile with 0 when no usage data available
          if (reservationId) {
            await reconcileReservation(
              redis, reservationId, 0, budgetEntities, connectionString,
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

        await logCostEvent(env.HYPERDRIVE.connectionString, costEvent);

        if (reservationId) {
          await reconcileReservation(
            redis, reservationId, costEvent.costMicrodollars,
            budgetEntities, connectionString,
          );
        }
      } catch (err) {
        console.error("[openai-route] Failed to process streaming cost event:", err);
        // Last-resort: try to reconcile with 0 on unexpected error
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
    const responseModel = parsed.model ?? null;
    const usage = parsed.usage;

    if (usage) {
      const costEvent = calculateOpenAICost(
        requestModel,
        responseModel,
        usage,
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
      // No usage in parsed response — reconcile with 0
      waitUntil(
        reconcileReservation(redis, reservationId, 0, budgetEntities, connectionString),
      );
    }
  } catch {
    console.error("[openai-route] Failed to parse non-streaming response for cost tracking");
    // Fix 6: reconcile on parse failure
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
