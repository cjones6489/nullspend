import { Redis } from "@upstash/redis/cloudflare";
import { handleChatCompletions } from "./routes/openai.js";
import { buildFailoverHeaders } from "./lib/headers.js";
import { OPENAI_BASE_URL } from "./lib/constants.js";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    ctx.passThroughOnException();

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
      let bodyText: string;
      try {
        bodyText = await request.text();
      } catch {
        return Response.json({ error: "bad_request", message: "Could not read request body" }, { status: 400 });
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

      try {
        return await handleChatCompletions(request, env, body);
      } catch (err) {
        console.error("[proxy] Route handler error, falling back to OpenAI directly:", err);

        const failoverUrl = OPENAI_BASE_URL + url.pathname;
        const failoverHeaders = buildFailoverHeaders(request);

        return fetch(failoverUrl, {
          method: "POST",
          headers: failoverHeaders,
          body: bodyText,
        });
      }
    }

    if (url.pathname.startsWith("/v1/")) {
      return Response.json(
        { error: "not_found", message: "This endpoint is not yet supported" },
        { status: 404 },
      );
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  },
};
