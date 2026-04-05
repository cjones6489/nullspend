import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { syncOrgRevenue, syncAllOrgs } from "@/lib/margins/sync";
import { withRequestContext } from "@/lib/observability";
import { getLogger } from "@/lib/observability";

const log = getLogger("revenue-sync-route");

/**
 * GET — Vercel Cron trigger (every 2 hours).
 * Validates CRON_SECRET bearer token.
 * Also callable manually via session auth (Sync Now button).
 */
export const GET = withRequestContext(async (request: Request) => {
  const authHeader = request.headers.get("authorization");

  // Cron path: validate CRON_SECRET
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const cronSecret = process.env.CRON_SECRET;
    if (
      !cronSecret ||
      token.length !== cronSecret.length ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(cronSecret))
    ) {
      return NextResponse.json(
        { error: { code: "authentication_required", message: "Invalid cron secret.", details: null } },
        { status: 401 },
      );
    }

    log.info("Cron-triggered revenue sync starting");
    const results = await syncAllOrgs();
    // Strip orgIds from cron response — only return aggregate counts
    return NextResponse.json({
      data: {
        synced: results.length,
        errors: results.filter((r) => r.error).length,
      },
    });
  }

  // Manual path: session auth (Sync Now button)
  const { userId, orgId } = await resolveSessionContext();
  await assertOrgRole(userId, orgId, "member");

  const result = await syncOrgRevenue(orgId);
  return NextResponse.json({ data: result });
});
