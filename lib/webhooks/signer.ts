import { createHmac } from "node:crypto";

/** 24-hour dual-signing window for secret rotation. SYNC: apps/proxy/src/lib/webhook-signer.ts */
export const SECRET_ROTATION_WINDOW_SECONDS = 86_400;

/**
 * Compute HMAC-SHA256 hex for a payload+timestamp using Node.js crypto.
 */
function computeHmacHex(
  payload: string,
  secret: string,
  timestamp: number,
): string {
  const content = `${timestamp}.${payload}`;
  return createHmac("sha256", secret).update(content).digest("hex");
}

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
  const hex = computeHmacHex(payload, secret, timestamp);
  return `t=${timestamp},v1=${hex}`;
}

/**
 * Dual-sign a webhook payload with current and (optionally) previous secret.
 * During rotation window: `t={ts},v1={currentHex},v1={previousHex}`
 * After rotation window (previousSecret is null): `t={ts},v1={currentHex}`
 * SYNC: apps/proxy/src/lib/webhook-signer.ts dualSignWebhookPayload
 */
export function dualSignPayload(
  payload: string,
  currentSecret: string,
  previousSecret: string | null,
  timestamp: number,
): string {
  const currentHex = computeHmacHex(payload, currentSecret, timestamp);
  if (!previousSecret) {
    return `t=${timestamp},v1=${currentHex}`;
  }
  const previousHex = computeHmacHex(payload, previousSecret, timestamp);
  return `t=${timestamp},v1=${currentHex},v1=${previousHex}`;
}
