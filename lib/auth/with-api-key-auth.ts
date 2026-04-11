import { NextResponse } from "next/server";
import { assertApiKeyWithIdentity, resolveDevFallbackApiKeyUserId } from "@/lib/auth/api-key";
import { checkKeyRateLimit } from "@/lib/auth/api-key-rate-limit";
import { ForbiddenError } from "@/lib/auth/errors";
import { assertOrgMember } from "@/lib/auth/org-authorization";
import { CURRENT_VERSION } from "@/lib/api-version";
import { getLogger } from "@/lib/observability";
import { setRequestUserId } from "@/lib/observability/request-context";
import { addSentryBreadcrumb } from "@/lib/observability/sentry";

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

export interface ApiKeyAuthContext {
  userId: string;
  orgId: string | null;
  keyId: string | null; // null for dev-mode env key
  apiVersion: string;
  allowedModels?: string[] | null;
  allowedProviders?: string[] | null;
  rateLimit?: RateLimitInfo; // present when per-key rate limiting is active
}

export async function authenticateApiKey(
  request: Request,
): Promise<ApiKeyAuthContext | Response> {
  const identity = await assertApiKeyWithIdentity(request);
  const userId = identity?.userId ?? resolveDevFallbackApiKeyUserId();
  const orgId = identity?.orgId ?? null;
  const keyId = identity?.keyId ?? null;

  // Per-key rate limit (skip for dev-mode keys with no keyId)
  if (keyId) {
    const result = await checkKeyRateLimit(keyId);
    if (!result.allowed) {
      getLogger("rate-limit").info({ keyId, userId }, "Per-key rate limit exceeded");
      const requestId = request.headers.get("x-request-id");
      const limit = result.limit ?? 0;
      const remaining = result.remaining ?? 0;
      const reset = result.reset ?? Date.now();
      const headers: Record<string, string> = {
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": String(remaining),
        "X-RateLimit-Reset": String(reset),
        "Retry-After": String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))),
        "Cache-Control": "private, no-store",
      };
      if (requestId) headers["x-request-id"] = requestId;
      return NextResponse.json(
        { error: { code: "rate_limit_exceeded", message: "Too many requests", details: null } },
        { status: 429, headers },
      );
    }
    // API-1: Verify key owner is still an org member (defense-in-depth).
    // Runs for ALL callers of authenticateApiKey, not just dual-auth routes.
    if (orgId) {
      try {
        await assertOrgMember(userId, orgId);
      } catch (err) {
        if (err instanceof ForbiddenError) {
          getLogger("auth").warn({ userId, orgId, keyId }, "API key used by non-member — possible missed revocation");
          return NextResponse.json(
            { error: { code: "forbidden", message: "API key owner is no longer a member of the associated organization.", details: null } },
            { status: 403 },
          );
        }
        throw err;
      }
    }

    setRequestUserId(userId);
    addSentryBreadcrumb("auth", "API key authenticated", { keyId, userId });
    return {
      userId, orgId, keyId,
      apiVersion: identity?.apiVersion ?? CURRENT_VERSION,
      allowedModels: identity?.allowedModels ?? null,
      allowedProviders: identity?.allowedProviders ?? null,
      rateLimit: result.limit != null
        ? { limit: result.limit, remaining: result.remaining ?? 0, reset: result.reset ?? 0 }
        : undefined,
    };
  }

  setRequestUserId(userId);
  addSentryBreadcrumb("auth", "API key authenticated", { keyId, userId });
  return {
    userId, orgId, keyId,
    apiVersion: identity?.apiVersion ?? CURRENT_VERSION,
    allowedModels: identity?.allowedModels ?? null,
    allowedProviders: identity?.allowedProviders ?? null,
  };
}

/** Set X-RateLimit-* headers on a response if rate limit info is available. */
export function applyRateLimitHeaders(response: NextResponse, rateLimit?: RateLimitInfo): NextResponse {
  if (!rateLimit) return response;
  response.headers.set("X-RateLimit-Limit", String(rateLimit.limit));
  response.headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
  response.headers.set("X-RateLimit-Reset", String(rateLimit.reset));
  return response;
}
