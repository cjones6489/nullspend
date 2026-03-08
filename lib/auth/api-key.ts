import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { eq, and, isNull } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { apiKeys } from "@/lib/db/schema";
import { getDevActor } from "@/lib/auth/session";

export const API_KEY_HEADER = "x-agentseam-key";
export const API_KEY_PREFIX = "ask_";

export class ApiKeyError extends Error {
  constructor(message = "Invalid or missing API key.") {
    super(message);
    this.name = "ApiKeyError";
  }
}

export interface ApiKeyIdentity {
  userId: string;
  keyId: string;
}

export function generateRawKey(): string {
  return API_KEY_PREFIX + randomBytes(16).toString("hex");
}

export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function extractPrefix(rawKey: string): string {
  return rawKey.slice(0, 12);
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function getEnvFallbackKey(): string | undefined {
  return process.env.AGENTSEAM_API_KEY;
}

async function lookupKeyInDb(rawKey: string): Promise<ApiKeyIdentity | null> {
  const db = getDb();
  const hash = hashKey(rawKey);

  const [row] = await db
    .select({ id: apiKeys.id, userId: apiKeys.userId })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!row) return null;

  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))

  return { userId: row.userId, keyId: row.id };
}

export function assertApiKey(request: Request): void {
  const providedKey = request.headers.get(API_KEY_HEADER);
  if (!providedKey) throw new ApiKeyError();

  const envKey = getEnvFallbackKey();
  if (envKey && constantTimeCompare(providedKey, envKey)) return;

  throw new ApiKeyError();
}

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

export function resolveDevFallbackApiKeyUserId(): string {
  const devActor = getDevActor();

  if (process.env.NODE_ENV !== "production" && devActor) {
    return devActor;
  }

  throw new ApiKeyError(
    "Managed API keys are required. The AGENTSEAM_API_KEY fallback is development-only.",
  );
}
