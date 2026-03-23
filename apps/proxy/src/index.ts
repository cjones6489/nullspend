import { handleChatCompletions } from "./routes/openai.js";
import { handleAnthropicMessages } from "./routes/anthropic.js";
import { handleMcpBudgetCheck, handleMcpEvents } from "./routes/mcp.js";
import { handleBudgetInvalidation, handleVelocityState } from "./routes/internal.js";
import { handleMetrics } from "./routes/metrics.js";
import { authenticateRequest } from "./lib/auth.js";
import { resolveApiVersion } from "./lib/api-version.js";
import { errorResponse } from "./lib/errors.js";
import { createWebhookDispatcher } from "./lib/webhook-dispatch.js";
import { mergeTags } from "./lib/tags.js";
import { resolveTraceId } from "./lib/trace-context.js";
import type { RequestContext, RouteHandler } from "./lib/context.js";
import { handleReconciliationQueue } from "./queue-handler.js";
import { handleDlqQueue, DLQ_QUEUE_NAME } from "./dlq-handler.js";
import { handleCostEventQueue, COST_EVENT_QUEUE_NAME } from "./cost-event-queue-handler.js";
import { handleCostEventDlq, COST_EVENT_DLQ_NAME } from "./cost-event-dlq-handler.js";
import type { ReconciliationMessage } from "./lib/reconciliation-queue.js";
import type { CostEventMessage } from "./lib/cost-event-queue.js";

export { UserBudgetDO } from "./durable-objects/user-budget.js";

const MAX_BODY_SIZE = 1_048_576; // 1MB

const routes = new Map<string, RouteHandler>();
routes.set("/v1/chat/completions", handleChatCompletions);
routes.set("/v1/messages", handleAnthropicMessages);
routes.set("/v1/mcp/budget/check", handleMcpBudgetCheck);
routes.set("/v1/mcp/events", handleMcpEvents);

/**
 * Rate limiting via Cloudflare native bindings.
 * Counters are on the same machine as the Worker — ~0ms overhead.
 * Limits are configured in wrangler.jsonc (per-IP: 120/min, per-key: 600/min).
 */
async function applyRateLimit(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";

  try {
    // Per-IP rate limit (abuse/DDoS protection)
    const { success: ipOk } = await env.IP_RATE_LIMITER.limit({ key: clientIp });
    if (!ipOk) {
      return Response.json(
        { error: { code: "rate_limited", message: "Too many requests", details: null } },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }

    // Per-key rate limit (runaway agent protection)
    const rateLimitKey = request.headers.get("x-nullspend-key");
    if (rateLimitKey && rateLimitKey.length <= 128) {
      const { success: keyOk } = await env.KEY_RATE_LIMITER.limit({ key: rateLimitKey });
      if (!keyOk) {
        return Response.json(
          { error: { code: "rate_limited", message: "Too many requests", details: null } },
          { status: 429, headers: { "Retry-After": "60" } },
        );
      }
    }
  } catch (err) {
    // Fail-open: if rate limiter binding is unavailable, allow the request
    console.error("[proxy] Rate limiter error:", err);
  }

  return null;
}

async function parseRequestBody(
  request: Request,
): Promise<{ body: Record<string, unknown>; error?: undefined } | { body?: undefined; error: Response }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return {
      error: errorResponse("payload_too_large", `Body exceeds ${MAX_BODY_SIZE} bytes`, 413),
    };
  }

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return {
      error: errorResponse("bad_request", "Could not read request body", 400),
    };
  }

  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_SIZE) {
    return {
      error: errorResponse("payload_too_large", `Body exceeds ${MAX_BODY_SIZE} bytes`, 413),
    };
  }

  try {
    const parsed = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        error: errorResponse("bad_request", "Request body must be a JSON object", 400),
      };
    }
    return { body: parsed };
  } catch {
    return {
      error: errorResponse("bad_request", "Invalid JSON body", 400),
    };
  }
}

const MAX_SESSION_ID_LENGTH = 256;

function truncateSessionId(raw: string | null): string | null {
  if (!raw) return null;
  return raw.length > MAX_SESSION_ID_LENGTH ? raw.slice(0, MAX_SESSION_ID_LENGTH) : raw;
}

export default {
  async queue(
    batch: MessageBatch<ReconciliationMessage | CostEventMessage>,
    env: Env,
  ): Promise<void> {
    if (batch.queue === COST_EVENT_DLQ_NAME) {
      await handleCostEventDlq(batch as MessageBatch<CostEventMessage>, env);
    } else if (batch.queue === COST_EVENT_QUEUE_NAME) {
      await handleCostEventQueue(batch as MessageBatch<CostEventMessage>, env);
    } else if (batch.queue === DLQ_QUEUE_NAME) {
      await handleDlqQueue(batch as MessageBatch<ReconciliationMessage>, env);
    } else {
      await handleReconciliationQueue(batch as MessageBatch<ReconciliationMessage>, env);
    }
  },

  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const requestStartMs = performance.now();
    const globals = globalThis as Record<string, unknown>;
    globals.__FORCE_DB_PERSIST =
      (env as Record<string, unknown>).FORCE_DB_PERSIST === "true";
    globals.__SKIP_DB_PERSIST =
      (env as Record<string, unknown>).SKIP_DB_PERSIST === "true";

    // Resolve trace ID early so it's available in the catch block for 500 responses
    const traceId = resolveTraceId(request);

    try {
      const url = new URL(request.url);

      // Health routes stay outside the pipeline (no auth needed)
      if (url.pathname === "/health") {
        return Response.json({ status: "ok", service: "nullspend-proxy" });
      }

      if (url.pathname === "/health/metrics") {
        return handleMetrics(request, env);
      }

      // Internal endpoints — separate auth pipeline (shared secret, not API key)
      if (url.pathname === "/internal/budget/invalidate" && request.method === "POST") {
        return handleBudgetInvalidation(request, env);
      }
      if (url.pathname === "/internal/budget/velocity-state" && request.method === "GET") {
        return handleVelocityState(request, env);
      }

      // Route lookup
      const handler = request.method === "POST" ? routes.get(url.pathname) : undefined;
      if (!handler) {
        if (url.pathname.startsWith("/v1/")) {
          return errorResponse("not_found", "This endpoint is not yet supported", 404);
        }
        return errorResponse("not_found", "Not found", 404);
      }

      // Rate limit + auth in parallel (neither reads request body)
      const connectionString = env.HYPERDRIVE.connectionString;
      const preFlightStartMs = performance.now();
      const [rateLimitResult, auth] = await Promise.all([
        applyRateLimit(request, env),
        authenticateRequest(request, connectionString),
      ]);
      const preFlightMs = Math.round(performance.now() - preFlightStartMs);

      if (rateLimitResult) return rateLimitResult;
      if (!auth) {
        return errorResponse("unauthorized", "Invalid or missing authentication header", 401);
      }

      // Body parse (sequential — budget check needs the parsed body)
      const bodyStartMs = performance.now();
      const result = await parseRequestBody(request);
      const bodyParseMs = Math.round(performance.now() - bodyStartMs);
      if (result.error) return result.error;

      // Build context
      const webhookDispatcher = auth.hasWebhooks
        ? createWebhookDispatcher(env.QSTASH_TOKEN || undefined)
        : null;

      if (auth.hasWebhooks && !webhookDispatcher) {
        console.warn("[proxy] User has webhooks but QSTASH_TOKEN is not configured");
      }

      const resolvedApiVersion = resolveApiVersion(
        request.headers.get("nullspend-version"),
        auth.apiVersion,
      );

      const tags = mergeTags(auth.defaultTags, request.headers.get("x-nullspend-tags"));

      const ctx: RequestContext = {
        body: result.body,
        auth,
        connectionString,
        sessionId: truncateSessionId(request.headers.get("x-nullspend-session")),
        traceId,
        tags,
        webhookDispatcher,
        resolvedApiVersion,
        requestStartMs,
        stepTiming: { preFlightMs, bodyParseMs },
      };

      const response = await handler(request, env, ctx);
      if (Object.keys(ctx.tags).length > 0) {
        response.headers.set("X-NullSpend-Effective-Tags", JSON.stringify(ctx.tags));
      }
      return response;
    } catch (err) {
      console.error("[proxy] Unhandled error:", { traceId, err });
      const resp = errorResponse("internal_error", "Internal server error", 500);
      resp.headers.set("X-NullSpend-Trace-Id", traceId);
      return resp;
    }
  },
};

