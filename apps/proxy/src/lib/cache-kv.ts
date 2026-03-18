/**
 * Shared webhook endpoint metadata. Defined here (not in webhook-cache.ts)
 * to avoid a circular dependency since webhook-cache.ts imports from this file.
 */
export interface CachedWebhookEndpoint {
  id: string;
  url: string;
  eventTypes: string[];
}

// KV minimum expirationTtl is 60 seconds (CF enforced)
const WEBHOOK_TTL = 300; // 5 minutes — matches Redis TTL

export async function getCachedWebhookEndpoints(
  kv: KVNamespace,
  userId: string,
): Promise<CachedWebhookEndpoint[] | null> {
  return kv.get<CachedWebhookEndpoint[]>(`webhook:${userId}`, "json");
}

export async function setCachedWebhookEndpoints(
  kv: KVNamespace,
  userId: string,
  endpoints: CachedWebhookEndpoint[],
): Promise<void> {
  await kv.put(`webhook:${userId}`, JSON.stringify(endpoints), {
    expirationTtl: WEBHOOK_TTL,
  });
}

export async function invalidateWebhookEndpoints(
  kv: KVNamespace,
  userId: string,
): Promise<void> {
  await kv.delete(`webhook:${userId}`);
}
