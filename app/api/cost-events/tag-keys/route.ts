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
    return handleRouteError(error);
  }
}
