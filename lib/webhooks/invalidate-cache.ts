import { getResilienceRedis } from "@/lib/resilience/redis";

const CACHE_KEY_PREFIX = "webhooks:user:";

/**
 * Invalidate the webhook endpoint cache in Redis for a given user.
 * Called from dashboard API routes after create/update/delete.
 * Fire-and-forget: logs errors but never throws.
 *
 * Note: Workers KV cache has its own 5-minute TTL and can't be invalidated
 * from the dashboard without a Cloudflare API call. The Redis invalidation
 * is sufficient: when the proxy's Redis cache misses, it queries DB and
 * re-populates both Redis and KV with fresh data.
 */
export async function invalidateWebhookCacheForUser(userId: string): Promise<void> {
  const redis = getResilienceRedis();
  if (!redis) return;
  try {
    await redis.del(`${CACHE_KEY_PREFIX}${userId}`);
  } catch (err) {
    console.error("[webhook-cache] Dashboard invalidation failed:", err);
  }
}
