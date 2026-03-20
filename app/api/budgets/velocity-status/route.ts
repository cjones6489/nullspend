import { NextResponse } from "next/server";

import { resolveSessionUserId } from "@/lib/auth/session";
import { withRequestContext } from "@/lib/observability";

/**
 * GET /api/budgets/velocity-status
 *
 * Session-authenticated endpoint that fetches live velocity state
 * from the proxy worker's Durable Object via the internal endpoint.
 *
 * Constraints:
 * - 3s timeout (user-facing polling endpoint)
 * - Zero retries (unlike proxy-invalidate which retries 2x)
 * - Returns { velocityState: [] } on ANY failure
 * - Returns { velocityState: [] } in local dev (no PROXY_INTERNAL_URL)
 */
export const GET = withRequestContext(async (_request: Request) => {
  const userId = await resolveSessionUserId();

  const url = process.env.PROXY_INTERNAL_URL;
  const secret = process.env.PROXY_INTERNAL_SECRET;

  if (!url || !secret) {
    return NextResponse.json({ velocityState: [] });
  }

  try {
    const res = await fetch(
      `${url}/internal/budget/velocity-state?userId=${encodeURIComponent(userId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secret}`,
        },
        signal: AbortSignal.timeout(3_000),
      },
    );

    if (!res.ok) {
      console.error("[velocity-status] Proxy returned non-2xx:", res.status);
      return NextResponse.json({ velocityState: [] });
    }

    const data = await res.json();
    return NextResponse.json({ velocityState: data.velocityState ?? [] });
  } catch (err) {
    console.error("[velocity-status] Failed to fetch velocity state:", err);
    return NextResponse.json({ velocityState: [] });
  }
});
