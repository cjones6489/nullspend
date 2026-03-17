import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { getLogger } from "@/lib/observability";

const DEFAULT_KEY_RATE_LIMIT = 60; // req/min per API key

let _limiter: Ratelimit | null | undefined;

/** @internal Reset singleton for testing only */
export function _resetKeyRatelimitForTesting() { _limiter = undefined; }

export function getKeyRatelimit(): Ratelimit | null {
  if (_limiter !== undefined) return _limiter;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    _limiter = null;
    return null;
  }
  const limit = Number(process.env.NULLSPEND_API_KEY_RATE_LIMIT) || DEFAULT_KEY_RATE_LIMIT;
  _limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(limit, "1 m"),
    prefix: "nullspend:api:rl:key",
    ephemeralCache: new Map(),
  });
  return _limiter;
}

export interface KeyRateLimitResult {
  allowed: boolean;
  limit?: number;
  remaining?: number;
  reset?: number;
}

// Fail-open: per-IP in proxy.ts (fail-closed) is the DDoS safety net.
// Per-key is about fairness between API keys.
export async function checkKeyRateLimit(keyId: string): Promise<KeyRateLimitResult> {
  const limiter = getKeyRatelimit();
  if (!limiter) return { allowed: true };
  try {
    // Note: `pending` is intentionally not captured. It is only needed when
    // `analytics: true` or `MultiRegion` is configured (neither applies here).
    // If analytics is added later, capture `pending` and pass to waitUntil().
    const { success, limit, remaining, reset } = await limiter.limit(keyId);
    return { allowed: success, limit, remaining, reset };
  } catch (err) {
    getLogger("rate-limit").warn({ err, keyId }, "Per-key rate limiter error — failing open");
    return { allowed: true };
  }
}
