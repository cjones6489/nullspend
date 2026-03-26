import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { eq, and, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { apiKeys } from "@nullspend/db";
import { getDevActor } from "@/lib/auth/session";

export const API_KEY_HEADER = "x-nullspend-key";
export const API_KEY_PREFIX = "ns_live_sk_";

export class ApiKeyError extends Error {
  constructor(message = "Invalid or missing API key.") {
    super(message);
    this.name = "ApiKeyError";
  }
}

export interface ApiKeyIdentity {
  userId: string;
  orgId: string | null;
  keyId: string;
  apiVersion: string;
}

export function generateRawKey(): string {
  return API_KEY_PREFIX + randomBytes(16).toString("hex");
}

export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function extractPrefix(rawKey: string): string {
  return rawKey.slice(0, 19);
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function canUseDevelopmentFallback(): boolean {
  return process.env.NULLSPEND_DEV_MODE === "true";
}

function getEnvFallbackKey(): string | undefined {
  if (!canUseDevelopmentFallback()) return undefined;
  return process.env.NULLSPEND_API_KEY;
}

// Debounced lastUsedAt updates — at most once per key per 60s
const lastUsedAtUpdated = new Map<string, number>();
const LAST_USED_DEBOUNCE_MS = 60_000;

async function lookupKeyInDb(rawKey: string): Promise<ApiKeyIdentity | null> {
  const db = getDb();
  const hash = hashKey(rawKey);

  const [row] = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId, orgId: apiKeys.orgId, apiVersion: apiKeys.apiVersion })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!row) return null;

  // Fire-and-forget debounced lastUsedAt update (no write contention on hot path)
  const now = Date.now();
  const lastUpdate = lastUsedAtUpdated.get(row.id) ?? 0;
  if (now - lastUpdate > LAST_USED_DEBOUNCE_MS) {
    lastUsedAtUpdated.set(row.id, now);
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .then(() => {})
      .catch(() => {}); // Best-effort, never block
  }

  return { userId: row.userId, orgId: row.orgId ?? null, keyId: row.id, apiVersion: row.apiVersion };
}

/** @internal Use `authenticateApiKey` from `with-api-key-auth.ts` in route handlers */
export async function assertApiKeyWithIdentity(
  request: Request,
): Promise<ApiKeyIdentity | null> {
  const providedKey = request.headers.get(API_KEY_HEADER);
  if (!providedKey) throw new ApiKeyError();

  const identity = await lookupKeyInDb(providedKey);
  if (identity) return identity;

  const envKey = getEnvFallbackKey();
  if (envKey && constantTimeCompare(providedKey, envKey)) return null;

  throw new ApiKeyError();
}

/** @internal Use `authenticateApiKey` from `with-api-key-auth.ts` in route handlers */
export function resolveDevFallbackApiKeyUserId(): string {
  const devActor = getDevActor();

  if (canUseDevelopmentFallback() && devActor) {
    return devActor;
  }

  throw new ApiKeyError(
    "Managed API keys are required. The NULLSPEND_API_KEY fallback is development-only.",
  );
}
