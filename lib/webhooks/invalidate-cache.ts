/**
 * Invalidate the webhook endpoint cache for a given user.
 * Called from dashboard API routes after create/update/delete.
 *
 * The proxy uses Workers KV for webhook endpoint caching (5-minute TTL).
 * Active invalidation from the dashboard would require a Cloudflare KV API
 * call or a proxy internal endpoint — deferred until needed.
 *
 * For now, this is a no-op: KV entries expire naturally within 5 minutes.
 * This is acceptable with zero users. When active invalidation is needed,
 * add a proxy internal endpoint that calls invalidateWebhookEndpoints()
 * on the CACHE_KV binding.
 */
export async function invalidateWebhookCacheForUser(_orgId: string): Promise<void> {
  // No-op: KV TTL handles expiry (5 minutes).
  // TODO: Add active KV invalidation via proxy internal endpoint when needed.
}
