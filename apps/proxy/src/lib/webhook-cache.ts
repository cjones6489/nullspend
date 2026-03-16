import type { Redis } from "@upstash/redis/cloudflare";
import { Client } from "pg";
import { withDbConnection } from "./db-semaphore.js";

const CACHE_KEY_PREFIX = "webhooks:user:";
const CACHE_TTL_SECONDS = 300; // 5 minutes
const CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Endpoint metadata cached in Redis. Does NOT include signing secrets —
 * secrets are fetched from DB only at dispatch time to avoid storing
 * sensitive material in the cache layer.
 */
export interface CachedWebhookEndpoint {
  id: string;
  url: string;
  eventTypes: string[];
}

/**
 * Full endpoint data including signing secret.
 * Returned from DB queries; never stored in Redis.
 */
export interface WebhookEndpointWithSecret extends CachedWebhookEndpoint {
  signingSecret: string;
}

/**
 * Get active webhook endpoints for a user (metadata only, no secrets).
 * Redis-cached with 5-minute TTL. Fail-open: returns [] on error.
 */
export async function getWebhookEndpoints(
  redis: Redis,
  connectionString: string,
  userId: string,
): Promise<CachedWebhookEndpoint[]> {
  const cacheKey = `${CACHE_KEY_PREFIX}${userId}`;

  try {
    const cached = await redis.get<CachedWebhookEndpoint[]>(cacheKey);
    if (cached) return cached;
  } catch (err) {
    console.error("[webhook-cache] Redis read error:", err);
    // Fail-open: fall through to DB query
  }

  let endpoints: WebhookEndpointWithSecret[];
  try {
    endpoints = await withDbConnection(() => queryActiveEndpoints(connectionString, userId));
  } catch (err) {
    console.error("[webhook-cache] DB query error:", err);
    return []; // Fail-open
  }

  // Cache metadata only — strip secrets before writing to Redis
  const metadata: CachedWebhookEndpoint[] = endpoints.map(({ id, url, eventTypes }) => ({
    id,
    url,
    eventTypes,
  }));

  try {
    await redis.set(cacheKey, JSON.stringify(metadata), { ex: CACHE_TTL_SECONDS });
  } catch (err) {
    console.error("[webhook-cache] Redis write error:", err);
  }

  return metadata;
}

/**
 * Get active webhook endpoints WITH signing secrets for dispatch.
 * Always queries DB — secrets are never cached.
 * Fail-open: returns [] on error.
 */
export async function getWebhookEndpointsWithSecrets(
  connectionString: string,
  userId: string,
): Promise<WebhookEndpointWithSecret[]> {
  try {
    return await withDbConnection(() => queryActiveEndpoints(connectionString, userId));
  } catch (err) {
    console.error("[webhook-cache] DB query error (secrets):", err);
    return []; // Fail-open
  }
}

/**
 * Invalidate the webhook endpoint cache for a user.
 * Called from dashboard API on create/update/delete.
 */
export async function invalidateWebhookCache(
  redis: Redis,
  userId: string,
): Promise<void> {
  const cacheKey = `${CACHE_KEY_PREFIX}${userId}`;
  try {
    await redis.del(cacheKey);
  } catch (err) {
    console.error("[webhook-cache] Cache invalidation error:", err);
  }
}

async function queryActiveEndpoints(
  connectionString: string,
  userId: string,
): Promise<WebhookEndpointWithSecret[]> {
  let client: Client | null = null;
  try {
    client = new Client({
      connectionString,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    });
    client.on("error", (err) => {
      console.error("[webhook-cache] pg client error:", err.message);
    });
    await client.connect();

    const result = await client.query(
      `SELECT id, url, signing_secret, event_types
       FROM webhook_endpoints
       WHERE user_id = $1 AND enabled = true`,
      [userId],
    );

    return result.rows.map((row) => ({
      id: row.id as string,
      url: row.url as string,
      signingSecret: row.signing_secret as string,
      eventTypes: (row.event_types as string[]) ?? [],
    }));
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // already closed
      }
    }
  }
}
