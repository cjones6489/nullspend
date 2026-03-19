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

async function lookupKeyInDb(rawKey: string): Promise<ApiKeyIdentity | null> {
  const db = getDb();
  const hash = hashKey(rawKey);

  const [row] = await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id, userId: apiKeys.userId, apiVersion: apiKeys.apiVersion });

  if (!row) return null;

  return { userId: row.userId, keyId: row.id, apiVersion: row.apiVersion };
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
