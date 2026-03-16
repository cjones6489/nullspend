import { Client } from "pg";
import { withDbConnection } from "./db-semaphore.js";

export interface ApiKeyIdentity {
  userId: string;
  keyId: string;
  hasBudgets: boolean;
  hasWebhooks: boolean;
}

const CONNECTION_TIMEOUT_MS = 5_000;
const CACHE_MAX_SIZE = 256;
const POSITIVE_TTL_MS = 60_000; // 60s
const NEGATIVE_TTL_MS = 30_000; // 30s

interface CacheEntry {
  identity: ApiKeyIdentity;
  expiresAt: number;
}

interface NegativeCacheEntry {
  expiresAt: number;
}

// Module-level caches — persist within the Workers isolate across requests
const positiveCache = new Map<string, CacheEntry>();
const negativeCache = new Map<string, NegativeCacheEntry>();

/**
 * SHA-256 hash using Web Crypto API (Workers runtime).
 * Returns hex string matching Node.js crypto.createHash("sha256").digest("hex").
 */
export async function hashApiKey(rawKey: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawKey),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Evict the oldest entry when the cache exceeds its max size.
 * Map iteration order in JS is insertion order, so the first key is the oldest.
 */
function evictIfNeeded(cache: Map<string, unknown>, maxSize: number): void {
  if (cache.size > maxSize) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
}

/**
 * Look up an API key by its SHA-256 hash in the database.
 * Returns { userId, keyId } for valid, non-revoked keys.
 *
 * Uses per-request pg.Client + Hyperdrive connection string
 * (same pattern as cost-logger.ts). Wrapped in withDbConnection
 * to respect the isolate connection semaphore.
 *
 * Never throws — returns null for invalid/revoked keys or DB errors.
 */
async function lookupKeyInDb(
  keyHash: string,
  connectionString: string,
): Promise<ApiKeyIdentity | null> {
  return withDbConnection(async () => {
    let client: Client | null = null;

    try {
      client = new Client({
        connectionString,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      });

      client.on("error", (err) => {
        console.error("[api-key-auth] pg client error event:", err.message);
      });

      await client.connect();

      const result = await client.query(
        `SELECT k.id, k.user_id,
          EXISTS(
            SELECT 1 FROM budgets b
            WHERE (b.entity_type = 'api_key' AND b.entity_id = k.id::text)
               OR (b.entity_type = 'user' AND b.entity_id = k.user_id)
          ) AS has_budgets,
          EXISTS(
            SELECT 1 FROM webhook_endpoints w
            WHERE w.user_id = k.user_id AND w.enabled = true
          ) AS has_webhooks
        FROM api_keys k
        WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
        [keyHash],
      );

      if (result.rows.length === 0) {
        return null;
      }

      return {
        userId: result.rows[0].user_id as string,
        keyId: result.rows[0].id as string,
        hasBudgets: result.rows[0].has_budgets === true,
        hasWebhooks: result.rows[0].has_webhooks === true,
      };
    } catch (err) {
      console.error(
        "[api-key-auth] Failed to look up API key:",
        err instanceof Error ? err.message : "Unknown error",
      );
      return null;
    } finally {
      if (client) {
        try {
          await client.end();
        } catch {
          // already closed or never connected
        }
      }
    }
  });
}

/**
 * Authenticate a raw API key.
 *
 * 1. Hash the key with SHA-256
 * 2. Check positive cache (valid keys, 60s TTL)
 * 3. Check negative cache (invalid keys, 30s TTL)
 * 4. Query the database
 * 5. Populate the appropriate cache
 *
 * Never throws — returns null for invalid/revoked keys.
 */
export async function authenticateApiKey(
  rawKey: string,
  connectionString: string,
): Promise<ApiKeyIdentity | null> {
  const keyHash = await hashApiKey(rawKey);
  const now = Date.now();

  // Check positive cache
  const cached = positiveCache.get(keyHash);
  if (cached) {
    if (cached.expiresAt > now) {
      return cached.identity;
    }
    positiveCache.delete(keyHash);
  }

  // Check negative cache
  const negativeCached = negativeCache.get(keyHash);
  if (negativeCached) {
    if (negativeCached.expiresAt > now) {
      return null;
    }
    negativeCache.delete(keyHash);
  }

  // DB lookup
  const identity = await lookupKeyInDb(keyHash, connectionString);

  if (identity) {
    positiveCache.set(keyHash, {
      identity,
      expiresAt: now + POSITIVE_TTL_MS,
    });
    evictIfNeeded(positiveCache, CACHE_MAX_SIZE);
  } else {
    negativeCache.set(keyHash, {
      expiresAt: now + NEGATIVE_TTL_MS,
    });
    evictIfNeeded(negativeCache, CACHE_MAX_SIZE);
  }

  return identity;
}

/**
 * Reset caches — exposed for testing only.
 */
export function _resetCaches(): void {
  positiveCache.clear();
  negativeCache.clear();
}
