import { NextResponse } from "next/server";
import { assertApiKeyWithIdentity, resolveDevFallbackApiKeyUserId } from "@/lib/auth/api-key";
import { checkKeyRateLimit } from "@/lib/auth/api-key-rate-limit";
import { getLogger } from "@/lib/observability";

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

export interface ApiKeyAuthContext {
  userId: string;
  keyId: string | null; // null for dev-mode env key
  rateLimit?: RateLimitInfo; // present when per-key rate limiting is active
}

export async function authenticateApiKey(
  request: Request,
): Promise<ApiKeyAuthContext | Response> {
  const identity = await assertApiKeyWithIdentity(request);
  const userId = identity?.userId ?? resolveDevFallbackApiKeyUserId();
  const keyId = identity?.keyId ?? null;

  // Per-key rate limit (skip for dev-mode keys with no keyId)
  if (keyId) {
    const result = await checkKeyRateLimit(keyId);
    if (!result.allowed) {
      getLogger("rate-limit").info({ keyId, userId }, "Per-key rate limit exceeded");
      const requestId = request.headers.get("x-request-id");
      const headers: Record<string, string> = {
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(result.reset),
        "Retry-After": String(Math.max(1, Math.ceil((result.reset! - Date.now()) / 1000))),
        "Cache-Control": "private, no-store",
      };
      if (requestId) headers["x-request-id"] = requestId;
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers },
      );
    }
    return {
      userId, keyId,
      rateLimit: { limit: result.limit!, remaining: result.remaining!, reset: result.reset! },
    };
  }

  return { userId, keyId };
}

/** Set X-RateLimit-* headers on a response if rate limit info is available. */
export function applyRateLimitHeaders(response: NextResponse, rateLimit?: RateLimitInfo): NextResponse {
  if (!rateLimit) return response;
  response.headers.set("X-RateLimit-Limit", String(rateLimit.limit));
  response.headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
  response.headers.set("X-RateLimit-Reset", String(rateLimit.reset));
  return response;
}
