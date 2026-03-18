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
      console.error("[proxy-invalidate] Failed:", res.status, { action: params.action });
    }
  } catch (err) {
    console.error("[proxy-invalidate] Error:", err instanceof Error ? err.message : String(err));
  }
}
