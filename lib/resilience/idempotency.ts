import { createHash } from "node:crypto";

import { getLogger } from "@/lib/observability";
import { getResilienceRedis } from "./redis";

const REDIS_PREFIX = "nullspend:idempotency:";
const SENTINEL_VALUE = "processing";
const SENTINEL_TTL_SECONDS = 60;
const DEFAULT_TTL_SECONDS = 86400; // 24h
const POLL_INTERVAL_MS = 200;
const POLL_MAX_ATTEMPTS = 5;

/** Status codes that should NOT be cached — transient decisions, not handler results. */
const UNCACHEABLE_STATUSES = new Set([429, 503]);

interface CachedResponse {
  status: number;
  body: string;
  headers: Record<string, string>;
  completedAt: string;
}

function isKillSwitchDisabled(): boolean {
  return process.env.NULLSPEND_IDEMPOTENCY_ENABLED === "false";
}

/** Extract all headers from a Response as a plain object. */
function extractHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

/** Build a Response from a cache entry, adding the replay marker header. */
function buildReplayResponse(cached: CachedResponse): Response {
  return new Response(cached.body, {
    status: cached.status,
    headers: {
      ...cached.headers,
      "X-Idempotent-Replayed": "true",
    },
  });
}

/**
 * Wraps a route handler with Redis-backed idempotency.
 *
 * If an `Idempotency-Key` header is present, the handler result is cached
 * and returned on subsequent requests with the same key.
 *
 * Reads ONLY the Idempotency-Key header — never consumes request.body.
 */
export async function withIdempotency(
  request: Request,
  handler: () => Promise<Response>,
  options?: { ttlSeconds?: number },
): Promise<Response> {
  const log = getLogger("idempotency");

  if (isKillSwitchDisabled()) {
    return handler();
  }

  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!idempotencyKey) {
    return handler();
  }

  const redis = getResilienceRedis();
  if (!redis) {
    log.warn("Redis unavailable — executing handler without idempotency");
    return handler();
  }

  // ACT-4: Scope key by caller identity + request path to prevent cross-tenant
  // or cross-endpoint replay. Uses a hash of the API key (not the raw key).
  const apiKey = request.headers.get("x-nullspend-key") ?? "";
  const callerHash = apiKey ? createHash("sha256").update(apiKey).digest("hex").slice(0, 12) : "anon";
  const routePath = new URL(request.url).pathname;
  const redisKey = `${REDIS_PREFIX}${callerHash}:${routePath}:${idempotencyKey}`;
  const ttl = options?.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  // Phase 1: Check for existing cached response (Redis GET)
  let cached: string | CachedResponse | null;
  try {
    cached = await redis.get<string | CachedResponse>(redisKey);
  } catch (err) {
    log.warn({ err, key: idempotencyKey }, "Redis GET error — failing open");
    return handler();
  }

  if (cached && typeof cached === "object" && "completedAt" in cached) {
    log.info({ key: idempotencyKey }, "Returning cached idempotent response");
    return buildReplayResponse(cached);
  }

  if (cached === SENTINEL_VALUE) {
    return await pollForCompletion(redis, redisKey, idempotencyKey, log);
  }

  // Phase 2: Acquire sentinel lock (Redis SET NX)
  let acquired: string | null;
  try {
    acquired = await redis.set(redisKey, SENTINEL_VALUE, {
      nx: true,
      ex: SENTINEL_TTL_SECONDS,
    });
  } catch (err) {
    log.warn({ err, key: idempotencyKey }, "Redis SET NX error — failing open");
    return handler();
  }

  if (!acquired) {
    return await pollForCompletion(redis, redisKey, idempotencyKey, log);
  }

  // Phase 3: Execute handler — we hold the lock
  let response: Response;
  try {
    response = await handler();
  } catch (error) {
    // Clean up sentinel so retries can proceed
    await redis.del(redisKey).catch(() => {});
    throw error;
  }

  // Phase 4: Cache the response
  // Consume the body and capture headers so we can cache and return a fresh copy.
  const responseBody = await response.text();
  const responseHeaders = extractHeaders(response);

  // Don't cache 5xx (retryable server errors) or transient statuses (429 rate limit, 503).
  // These are not handler results — they're infrastructure decisions that may change.
  if (response.status >= 500 || UNCACHEABLE_STATUSES.has(response.status)) {
    await redis.del(redisKey).catch(() => {});
  } else {
    const cacheEntry: CachedResponse = {
      status: response.status,
      body: responseBody,
      headers: responseHeaders,
      completedAt: new Date().toISOString(),
    };

    try {
      await redis.set(redisKey, cacheEntry, { ex: ttl });
    } catch (err) {
      // Redis cache write failed after handler succeeded.
      // Delete sentinel so the next request can retry, but return
      // the current response — never re-execute the handler.
      log.warn({ err, key: idempotencyKey }, "Redis cache write error — returning uncached response");
      await redis.del(redisKey).catch(() => {});
    }
  }

  // Return a fresh response (original was consumed by .text())
  return new Response(responseBody, {
    status: response.status,
    headers: responseHeaders,
  });
}

async function pollForCompletion(
  redis: ReturnType<typeof getResilienceRedis> & object,
  redisKey: string,
  idempotencyKey: string,
  log: ReturnType<typeof getLogger>,
): Promise<Response> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    try {
      const result = await redis.get<string | CachedResponse>(redisKey);
      if (result && typeof result === "object" && "completedAt" in result) {
        log.info({ key: idempotencyKey }, "Returning cached idempotent response (after poll)");
        return buildReplayResponse(result);
      }
    } catch {
      // Redis error during polling — continue polling or fall through to 503
    }
  }

  // Still processing after polling — return 503
  log.warn({ key: idempotencyKey }, "Concurrent duplicate still processing after poll timeout");
  return new Response(
    JSON.stringify({ error: { code: "request_in_progress", message: "Request is being processed. Please retry.", details: null } }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "1",
      },
    },
  );
}
