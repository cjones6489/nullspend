import { authenticateApiKey, type ApiKeyIdentity } from "./api-key-auth.js";

export type { ApiKeyIdentity };

export interface AuthResult {
  userId: string;
  keyId: string;
  hasBudgets: boolean;
}

/**
 * API key authentication for the proxy.
 *
 * Reads `x-nullspend-key` header, looks up by SHA-256 hash in DB.
 * Returns null for invalid/missing credentials (caller should return 401).
 */
export async function authenticateRequest(
  request: Request,
  connectionString: string,
): Promise<AuthResult | null> {
  const apiKey = request.headers.get("x-nullspend-key");
  if (!apiKey) return null;
  const identity = await authenticateApiKey(apiKey, connectionString);
  if (!identity) return null;
  return { userId: identity.userId, keyId: identity.keyId, hasBudgets: identity.hasBudgets };
}
