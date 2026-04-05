import { NextResponse } from "next/server";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getMarginTable } from "@/lib/margins/margin-query";
import { formatPeriod, currentMonthStart } from "@/lib/margins/periods";
import { withRequestContext } from "@/lib/observability";

export const GET = withRequestContext(async (request: Request) => {
  const { userId, orgId } = await resolveSessionContext();
  await assertOrgRole(userId, orgId, "viewer");

  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? formatPeriod(currentMonthStart());

  // Validate period format
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "period must be YYYY-MM format.", details: null } },
      { status: 400 },
    );
  }

  const result = await getMarginTable(orgId, period);
  return NextResponse.json({ data: result });
});
