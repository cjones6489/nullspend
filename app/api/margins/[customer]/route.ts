import { NextResponse } from "next/server";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getCustomerDetail } from "@/lib/margins/margin-query";
import { formatPeriod, currentMonthStart } from "@/lib/margins/periods";
import { withRequestContext } from "@/lib/observability";
import { readRouteParams } from "@/lib/utils/http";

export const GET = withRequestContext(
  async (request: Request, ctx: { params: Promise<{ customer: string }> }) => {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");

    const { customer } = await readRouteParams(ctx.params);
    let tagValue: string;
    try {
      tagValue = decodeURIComponent(customer);
    } catch {
      return NextResponse.json(
        { error: { code: "validation_error", message: "Invalid customer tag value.", details: null } },
        { status: 400 },
      );
    }

    const url = new URL(request.url);
    const period = url.searchParams.get("period") ?? formatPeriod(currentMonthStart());

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      return NextResponse.json(
        { error: { code: "validation_error", message: "period must be YYYY-MM format.", details: null } },
        { status: 400 },
      );
    }

    const detail = await getCustomerDetail(orgId, tagValue, period);
    if (!detail) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Customer mapping not found.", details: null } },
        { status: 404 },
      );
    }

    return NextResponse.json({ data: detail });
  },
);
