import { waitUntil } from "cloudflare:workers";
import { validatePlatformKey, unauthorizedResponse } from "../lib/auth.js";
import { buildUpstreamHeaders, buildClientHeaders } from "../lib/headers.js";
import { ensureStreamOptions, extractModelFromBody } from "../lib/request-utils.js";
import { createSSEParser } from "../lib/sse-parser.js";
import { calculateOpenAICost } from "../lib/cost-calculator.js";
import { isKnownModel } from "@agentseam/cost-engine";
import { logCostEvent } from "../lib/cost-logger.js";
import { OPENAI_BASE_URL } from "../lib/constants.js";

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

  const upstreamHeaders = buildUpstreamHeaders(request);
  const startTime = performance.now();

  // Workers have no CPU time limit on streaming responses (wall-clock is fine).
  // Non-streaming GPT-4 class models can take >25s; 120s gives them room.
  const UPSTREAM_TIMEOUT_MS = 120_000;

  const upstreamResponse = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: upstreamHeaders,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!upstreamResponse.ok) {
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
    );
  }

  return handleNonStreaming(
    upstreamResponse,
    clientHeaders,
    requestModel,
    requestId,
    startTime,
    env,
    attribution,
  );
}

type Attribution = { userId: string | null; apiKeyId: string | null };

function handleStreaming(
  upstreamResponse: Response,
  clientHeaders: Headers,
  requestModel: string,
  requestId: string,
  startTime: number,
  env: Env,
  attribution: Attribution,
): Response {
  const upstreamBody = upstreamResponse.body;
  if (!upstreamBody) {
    return new Response("No response body from upstream", { status: 502 });
  }

  const { readable, resultPromise } = createSSEParser(upstreamBody);

  waitUntil(
    resultPromise.then(async (result) => {
      try {
        const durationMs = Math.round(performance.now() - startTime);

        if (!result?.usage) return;

        const costEvent = calculateOpenAICost(
          requestModel,
          result.model,
          result.usage,
          requestId,
          durationMs,
          attribution,
        );

        await logCostEvent(env.HYPERDRIVE.connectionString, costEvent);
      } catch (err) {
        console.error("[openai-route] Failed to process streaming cost event:", err);
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
    }
  } catch {
    console.error("[openai-route] Failed to parse non-streaming response for cost tracking");
  }

  return new Response(responseText, {
    status: upstreamResponse.status,
    headers: clientHeaders,
  });
}
