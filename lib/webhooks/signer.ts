import { createHmac } from "node:crypto";

/**
 * Sign a webhook payload using HMAC-SHA256.
 * Dashboard-side signer using Node.js crypto (not Web Crypto API).
 * Produces the same signature format as the proxy's webhook-signer.ts.
 */
export function signPayload(
  payload: string,
  secret: string,
  timestamp: number,
): string {
  const content = `${timestamp}.${payload}`;
  const hex = createHmac("sha256", secret).update(content).digest("hex");
  return `t=${timestamp},v1=${hex}`;
}
