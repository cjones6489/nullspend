import { Redis } from "@upstash/redis";

let _redis: Redis | null | undefined;

/** @internal Reset singleton for testing only. */
export function _resetResilienceRedisForTesting(): void {
  _redis = undefined;
}

/**
 * Lazy singleton Redis client for resilience features (idempotency, etc.).
 * Returns null if UPSTASH env vars are missing.
 * Pattern matches getKeyRatelimit() in lib/auth/api-key-rate-limit.ts.
 */
export function getResilienceRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    _redis = null;
    return null;
  }
  _redis = Redis.fromEnv();
  return _redis;
}
