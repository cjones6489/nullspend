import { Redis } from "@upstash/redis/cloudflare";
import { Ratelimit } from "@upstash/ratelimit";
import { handleChatCompletions } from "./routes/openai.js";
import { handleAnthropicMessages } from "./routes/anthropic.js";
import { handleMcpBudgetCheck, handleMcpEvents } from "./routes/mcp.js";
import { handleBudgetInvalidation, handleVelocityState } from "./routes/internal.js";
import { handleMetrics } from "./routes/metrics.js";
import { authenticateRequest } from "./lib/auth.js";
import { resolveApiVersion } from "./lib/api-version.js";
import { errorResponse } from "./lib/errors.js";
import { createWebhookDispatcher } from "./lib/webhook-dispatch.js";
import { parseTags } from "./lib/tags.js";
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
const DEFAULT_RATE_LIMIT = 120;
const DEFAULT_KEY_RATE_LIMIT = 600;

const routes = new Map<string, RouteHandler>();
routes.set("/v1/chat/completions", handleChatCompletions);
routes.set("/v1/messages", handleAnthropicMessages);
routes.set("/v1/mcp/budget/check", handleMcpBudgetCheck);
routes.set("/v1/mcp/events", handleMcpEvents);

async function applyRateLimit(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
  try {
    const redis = Redis.fromEnv(env);
    const rateLimit =
      Number((env as Record<string, unknown>).PROXY_RATE_LIMIT) ||
      DEFAULT_RATE_LIMIT;

    // Per-IP rate limit
    const ipLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(rateLimit, "1 m"),
      prefix: "nullspend:proxy:rl:ip",
    });
    const ipResult = await ipLimiter.limit(clientIp);
    if (!ipResult.success) {
      return rateLimitResponse(ipResult);
    }

    // Per-key rate limit
    const rateLimitKey = request.headers.get("x-nullspend-key");
    if (rateLimitKey && rateLimitKey.length <= 128) {
      const keyRateLimit =
        Number((env as Record<string, unknown>).PROXY_KEY_RATE_LIMIT) ||
        DEFAULT_KEY_RATE_LIMIT;
      const keyLimiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(keyRateLimit, "1 m"),
        prefix: "nullspend:proxy:rl:key",
      });
      const keyResult = await keyLimiter.limit(rateLimitKey);
      if (!keyResult.success) {
        return rateLimitResponse(keyResult);
      }
    }
  } catch (err) {
    console.error("[proxy] Rate limiter error:", err);
  }
  return null;
}

function rateLimitResponse(result: { limit: number; remaining: number; reset: number }): Response {
  return Response.json(
    { error: { code: "rate_limited", message: "Too many requests", details: null } },
    {
      status: 429,
      headers: {
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(result.reset),
        "Retry-After": String(
          Math.ceil((result.reset - Date.now()) / 1000),
        ),
      },
    },
  );
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

      if (url.pathname === "/health/ready") {
        try {
          const redis = Redis.fromEnv(env);
          const pong = await redis.ping();
          return Response.json({ status: "ok", redis: pong });
        } catch {
          return Response.json(
            { status: "error", redis: "unreachable" },
            { status: 503 },
          );
        }
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

      // Rate limit
      const rateLimitResult = await applyRateLimit(request, env);
      if (rateLimitResult) return rateLimitResult;

      // Body parse
      const result = await parseRequestBody(request);
      if (result.error) return result.error;

      // Auth
      const connectionString = env.HYPERDRIVE.connectionString;
      const auth = await authenticateRequest(request, connectionString);
      if (!auth) {
        return errorResponse("unauthorized", "Invalid or missing authentication header", 401);
      }

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

      const ctx: RequestContext = {
        body: result.body,
        auth,
        redis: auth.hasWebhooks ? Redis.fromEnv(env) : null,
        connectionString,
        sessionId: truncateSessionId(request.headers.get("x-nullspend-session")),
        traceId,
        tags: parseTags(request.headers.get("x-nullspend-tags")),
        webhookDispatcher,
        resolvedApiVersion,
        requestStartMs,
      };

      return await handler(request, env, ctx);
    } catch (err) {
      console.error("[proxy] Unhandled error:", { traceId, err });
      const resp = errorResponse("internal_error", "Internal server error", 500);
      resp.headers.set("X-NullSpend-Trace-Id", traceId);
      return resp;
    }
  },
};

