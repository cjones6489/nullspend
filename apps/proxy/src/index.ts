import { Redis } from "@upstash/redis/cloudflare";
import { Ratelimit } from "@upstash/ratelimit";
import { handleChatCompletions } from "./routes/openai.js";

const MAX_BODY_SIZE = 1_048_576; // 1MB
const DEFAULT_RATE_LIMIT = 120;


export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // No passThroughOnException() — FinOps proxy must fail closed, never forward
    // unauthenticated/untracked requests to the origin.

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
          return Response.json({ status: "error", redis: "unreachable" }, { status: 503 });
        }
      }

      if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
        // Rate limiting — per connecting IP via sliding window
        const clientIp = request.headers.get("cf-connecting-ip") ?? "unknown";
        try {
          const rateLimit = Number((env as Record<string, unknown>).PROXY_RATE_LIMIT) || DEFAULT_RATE_LIMIT;
          const ratelimit = new Ratelimit({
            redis: Redis.fromEnv(env),
            limiter: Ratelimit.slidingWindow(rateLimit, "1 m"),
            prefix: "agentseam:proxy:rl",
          });
          const { success, limit, remaining, reset } = await ratelimit.limit(clientIp);
          if (!success) {
            return Response.json(
              { error: "rate_limited", message: "Too many requests" },
              {
                status: 429,
                headers: {
                  "X-RateLimit-Limit": String(limit),
                  "X-RateLimit-Remaining": String(remaining),
                  "X-RateLimit-Reset": String(reset),
                  "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)),
                },
              },
            );
          }
        } catch (err) {
          // Rate limiter failure should not block requests — log and continue
          console.error("[proxy] Rate limiter error:", err);
        }
        // Body size check — reject before reading into memory
        const contentLength = request.headers.get("content-length");
        if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
          return Response.json(
            { error: "payload_too_large", message: `Body exceeds ${MAX_BODY_SIZE} bytes` },
            { status: 413 },
          );
        }

        let bodyText: string;
        try {
          bodyText = await request.text();
        } catch {
          return Response.json({ error: "bad_request", message: "Could not read request body" }, { status: 400 });
        }

        // Enforce body size after reading (Content-Length can be spoofed/missing)
        if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_SIZE) {
          return Response.json(
            { error: "payload_too_large", message: `Body exceeds ${MAX_BODY_SIZE} bytes` },
            { status: 413 },
          );
        }

        let body: Record<string, unknown>;
        try {
          const parsed = JSON.parse(bodyText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return Response.json({ error: "bad_request", message: "Request body must be a JSON object" }, { status: 400 });
          }
          body = parsed;
        } catch {
          return Response.json({ error: "bad_request", message: "Invalid JSON body" }, { status: 400 });
        }

        return await handleChatCompletions(request, env, body);
      }

      if (url.pathname.startsWith("/v1/")) {
        return Response.json(
          { error: "not_found", message: "This endpoint is not yet supported" },
          { status: 404 },
        );
      }

      return Response.json({ error: "not_found", message: "Not found" }, { status: 404 });
    } catch (err) {
      console.error("[proxy] Unhandled error:", err);
      return Response.json({ error: "internal_error", message: "Internal server error" }, { status: 502 });
    }
  },
};
