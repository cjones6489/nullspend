import { getLogger } from "@/lib/observability";
import { addSentryBreadcrumb } from "@/lib/observability/sentry";

const log = getLogger("proxy-invalidate");

/**
 * Fire-and-forget dashboard→proxy cache invalidation.
 * No-ops silently when PROXY_INTERNAL_URL is unconfigured (local dev).
 */
export async function invalidateProxyCache(params: {
  action: "remove" | "reset_spend";
  userId: string;
  entityType: string;
  entityId: string;
}): Promise<void> {
  const url = process.env.PROXY_INTERNAL_URL;
  const secret = process.env.PROXY_INTERNAL_SECRET;
  if (!url || !secret) return;

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
    if (!res.ok) {
      log.error(
        { status: res.status, action: params.action, userId: params.userId,
          entityType: params.entityType, entityId: params.entityId },
        "Proxy cache invalidation failed",
      );
      addSentryBreadcrumb("proxy-invalidate", "Invalidation failed", {
        status: res.status, action: params.action, userId: params.userId,
      });
    } else {
      log.info(
        { action: params.action, userId: params.userId,
          entityType: params.entityType, entityId: params.entityId },
        "Proxy cache invalidated",
      );
    }
  } catch (err) {
    log.error(
      { err, action: params.action, userId: params.userId,
        entityType: params.entityType, entityId: params.entityId },
      "Proxy cache invalidation error",
    );
    addSentryBreadcrumb("proxy-invalidate", "Invalidation error", {
      error: err instanceof Error ? err.message : String(err),
      action: params.action, userId: params.userId,
    });
  }
}
