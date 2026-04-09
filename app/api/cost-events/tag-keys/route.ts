import { NextResponse } from "next/server";

import { CURRENT_VERSION } from "@/lib/api-version";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import { getDistinctTagKeys } from "@/lib/cost-events/aggregate-cost-events";
import { handleRouteError } from "@/lib/utils/http";

export async function GET() {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");

    const keys = await getDistinctTagKeys(orgId);

    const res = NextResponse.json({ data: keys });
    res.headers.set("NullSpend-Version", CURRENT_VERSION);
    return res;
  } catch (error) {
    // TEMPORARY P1-19 diagnostic: surface error detail for this one route.
    // REMOVE after root cause identified. Tracked in task #19.
    if (error instanceof Error) {
      const e = error as Error & {
        code?: string; severity?: string; detail?: string; hint?: string;
        cause?: unknown;
      };
      const causeInfo = e.cause instanceof Error ? {
        name: e.cause.name,
        message: e.cause.message,
        code: (e.cause as Error & { code?: string }).code,
      } : e.cause;
      return NextResponse.json({
        error: {
          code: "debug_p1_19",
          message: error.message,
          details: {
            name: error.name,
            stack: error.stack?.substring(0, 800),
            code: e.code,
            severity: e.severity,
            detail: e.detail,
            hint: e.hint,
            cause: causeInfo,
          },
        },
      }, { status: 500 });
    }
    return handleRouteError(error);
  }
}
