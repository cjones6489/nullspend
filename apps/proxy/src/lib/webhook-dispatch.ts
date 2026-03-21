import { Client as QStashClient } from "@upstash/qstash";
import { dualSignWebhookPayload, SECRET_ROTATION_WINDOW_SECONDS } from "./webhook-signer.js";
import type { WebhookEndpointWithSecret } from "./webhook-cache.js";
import type { AnyWebhookEvent } from "./webhook-events.js";

function isWithinRotationWindow(rotatedAt: string | null): boolean {
  if (!rotatedAt) return false;
  const elapsed = Date.now() - new Date(rotatedAt).getTime();
  return elapsed < SECRET_ROTATION_WINDOW_SECONDS * 1000;
}

export interface WebhookDispatcher {
  dispatch(endpoint: WebhookEndpointWithSecret, event: AnyWebhookEvent): Promise<void>;
}

/**
 * Create a webhook dispatcher backed by QStash.
 * Returns null if QSTASH_TOKEN is not configured.
 */
export function createWebhookDispatcher(
  qstashToken: string | undefined,
): WebhookDispatcher | null {
  if (!qstashToken) return null;

  const qstash = new QStashClient({ token: qstashToken });

  return {
    async dispatch(
      endpoint: WebhookEndpointWithSecret,
      event: AnyWebhookEvent,
    ): Promise<void> {
      // Event type filter: empty array = all events
      if (
        endpoint.eventTypes.length > 0 &&
        !endpoint.eventTypes.includes(event.type)
      ) {
        return;
      }

      const payload = JSON.stringify(event);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await dualSignWebhookPayload(
        payload,
        endpoint.signingSecret,
        isWithinRotationWindow(endpoint.secretRotatedAt) ? endpoint.previousSigningSecret : null,
        timestamp,
      );

      await qstash.publishJSON({
        url: endpoint.url,
        body: event,
        headers: {
          "X-NullSpend-Signature": signature,
          "X-NullSpend-Webhook-Id": event.id,
          "X-NullSpend-Webhook-Timestamp": String(timestamp),
          "User-Agent": "NullSpend-Webhooks/1.0",
        },
        retries: 5,
      });
    },
  };
}

/**
 * Dispatch a webhook event to all matching endpoints.
 * Fail-open: errors are logged but never thrown.
 */
export async function dispatchToEndpoints(
  dispatcher: WebhookDispatcher,
  endpoints: WebhookEndpointWithSecret[],
  event: AnyWebhookEvent,
): Promise<void> {
  for (const endpoint of endpoints) {
    try {
      await dispatcher.dispatch(endpoint, event);
    } catch (err) {
      console.error(
        `[webhook-dispatch] Failed to dispatch ${event.type} to ${endpoint.id}:`,
        err,
      );
    }
  }
}
