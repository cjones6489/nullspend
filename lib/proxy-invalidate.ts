import { getLogger } from "@/lib/observability";
import { addSentryBreadcrumb } from "@/lib/observability/sentry";

const log = getLogger("proxy-invalidate");

const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [1_000, 3_000];

/**
 * Dashboard→proxy cache invalidation with retry.
 * Retries up to MAX_RETRIES times on failure (network error or non-2xx).
 * No-ops silently when PROXY_INTERNAL_URL is unconfigured (local dev).
 * Never throws — all errors are logged and swallowed.
 */
export async function invalidateProxyCache(params: {
  action: "remove" | "reset_spend" | "sync";
  userId: string;
  entityType: string;
  entityId: string;
}): Promise<void> {
  const url = process.env.PROXY_INTERNAL_URL;
  const secret = process.env.PROXY_INTERNAL_SECRET;
  if (!url || !secret) return;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${url}/internal/budget/invalidate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        log.info(
          { action: params.action, userId: params.userId,
            entityType: params.entityType, entityId: params.entityId,
            ...(attempt > 0 && { retries: attempt }) },
          "Proxy cache invalidated",
        );
        return;
      }

      // Non-2xx — log and retry
      log.error(
        { status: res.status, action: params.action, userId: params.userId,
          entityType: params.entityType, entityId: params.entityId, attempt },
        "Proxy cache invalidation failed",
      );
      if (attempt === MAX_RETRIES) {
        log.warn(
          { action: params.action, userId: params.userId,
            entityType: params.entityType, entityId: params.entityId,
            retries: MAX_RETRIES },
          "Budget sync gap: budget exists in Postgres but is not enforced by DO until next successful sync",
        );
        addSentryBreadcrumb("proxy-invalidate", "Invalidation failed after retries", {
          status: res.status, action: params.action, userId: params.userId,
          retries: MAX_RETRIES,
        });
        return;
      }
    } catch (err) {
      log.error(
        { err, action: params.action, userId: params.userId,
          entityType: params.entityType, entityId: params.entityId, attempt },
        "Proxy cache invalidation error",
      );
      if (attempt === MAX_RETRIES) {
        log.warn(
          { action: params.action, userId: params.userId,
            entityType: params.entityType, entityId: params.entityId,
            retries: MAX_RETRIES },
          "Budget sync gap: budget exists in Postgres but is not enforced by DO until next successful sync",
        );
        addSentryBreadcrumb("proxy-invalidate", "Invalidation error after retries", {
          error: err instanceof Error ? err.message : String(err),
          action: params.action, userId: params.userId,
          retries: MAX_RETRIES,
        });
        return;
      }
    }

    // Wait before retry
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }
}
