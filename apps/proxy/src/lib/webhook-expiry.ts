import { Client } from "pg";
import { withDbConnection } from "./db-semaphore.js";
import { SECRET_ROTATION_WINDOW_SECONDS } from "./webhook-signer.js";
import type { WebhookEndpointWithSecret } from "./webhook-cache.js";

const CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Lazy-expire rotated secrets that are past the 24h window.
 * Fire-and-forget: wrapped in try/catch, never blocks dispatch.
 */
export async function expireRotatedSecrets(
  connectionString: string,
  endpoints: WebhookEndpointWithSecret[],
): Promise<void> {
  const expiredIds = endpoints
    .filter((ep) => {
      if (!ep.secretRotatedAt) return false;
      const elapsed = Date.now() - new Date(ep.secretRotatedAt).getTime();
      return elapsed >= SECRET_ROTATION_WINDOW_SECONDS * 1000;
    })
    .map((ep) => ep.id);

  if (expiredIds.length === 0) return;

  await withDbConnection(async () => {
    let client: Client | null = null;
    try {
      client = new Client({
        connectionString,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      });
      client.on("error", (err) => {
        console.error("[webhook-expiry] pg client error:", err.message);
      });
      await client.connect();

      await client.query(
        `UPDATE webhook_endpoints
         SET previous_signing_secret = NULL, secret_rotated_at = NULL
         WHERE id = ANY($1) AND secret_rotated_at < NOW() - INTERVAL '24 hours'`,
        [expiredIds],
      );
    } finally {
      if (client) {
        try {
          await client.end();
        } catch {
          // already closed
        }
      }
    }
  });
}
