import { Redis } from "@upstash/redis/cloudflare";
import { Ratelimit } from "@upstash/ratelimit";
import { handleChatCompletions } from "./routes/openai.js";
import { handleAnthropicMessages } from "./routes/anthropic.js";

const MAX_BODY_SIZE = 1_048_576; // 1MB
const DEFAULT_RATE_LIMIT = 120;
const DEFAULT_KEY_RATE_LIMIT = 600;

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
      prefix: "agentseam:proxy:rl:ip",
    });
    const ipResult = await ipLimiter.limit(clientIp);
    if (!ipResult.success) {
      return rateLimitResponse(ipResult);
    }

    // Per-key rate limit (if key-id header is present)
    const keyId = request.headers.get("x-agentseam-key-id");
    if (keyId && keyId.length <= 128) {
      const keyRateLimit =
        Number((env as Record<string, unknown>).PROXY_KEY_RATE_LIMIT) ||
        DEFAULT_KEY_RATE_LIMIT;
      const keyLimiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(keyRateLimit, "1 m"),
        prefix: "agentseam:proxy:rl:key",
      });
      const keyResult = await keyLimiter.limit(keyId);
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
    { error: "rate_limited", message: "Too many requests" },
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
      error: Response.json(
        {
          error: "payload_too_large",
          message: `Body exceeds ${MAX_BODY_SIZE} bytes`,
        },
        { status: 413 },
      ),
    };
  }

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return {
      error: Response.json(
        { error: "bad_request", message: "Could not read request body" },
        { status: 400 },
      ),
    };
  }

  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_SIZE) {
    return {
      error: Response.json(
        {
          error: "payload_too_large",
          message: `Body exceeds ${MAX_BODY_SIZE} bytes`,
        },
        { status: 413 },
      ),
    };
  }

  try {
    const parsed = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        error: Response.json(
          {
            error: "bad_request",
            message: "Request body must be a JSON object",
          },
          { status: 400 },
        ),
      };
    }
    return { body: parsed };
  } catch {
    return {
      error: Response.json(
        { error: "bad_request", message: "Invalid JSON body" },
        { status: 400 },
      ),
    };
  }
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const globals = globalThis as Record<string, unknown>;
    globals.__FORCE_DB_PERSIST =
      (env as Record<string, unknown>).FORCE_DB_PERSIST === "true";
    globals.__SKIP_DB_PERSIST =
      (env as Record<string, unknown>).SKIP_DB_PERSIST === "true";

    try {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return Response.json({ status: "ok", service: "agentseam-proxy" });
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

      if (
        request.method === "POST" &&
        (url.pathname === "/v1/chat/completions" ||
          url.pathname === "/v1/messages")
      ) {
        const rateLimitResponse = await applyRateLimit(request, env);
        if (rateLimitResponse) return rateLimitResponse;

        const result = await parseRequestBody(request);
        if (result.error) return result.error;

        if (url.pathname === "/v1/chat/completions") {
          return await handleChatCompletions(request, env, result.body);
        }
        return await handleAnthropicMessages(request, env, result.body);
      }

      if (url.pathname.startsWith("/v1/")) {
        return Response.json(
          {
            error: "not_found",
            message: "This endpoint is not yet supported",
          },
          { status: 404 },
        );
      }

      return Response.json(
        { error: "not_found", message: "Not found" },
        { status: 404 },
      );
    } catch (err) {
      console.error("[proxy] Unhandled error:", err);
      return Response.json(
        { error: "internal_error", message: "Internal server error" },
        { status: 502 },
      );
    }
  },
};
