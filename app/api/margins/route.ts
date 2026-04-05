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
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "period must be YYYY-MM format.", details: null } },
      { status: 400 },
    );
  }

  const result = await getMarginTable(orgId, period);

  // CSV export
  const format = url.searchParams.get("format");
  if (format === "csv") {
    const rows = result.customers.map((c) => [
      csvEscape(c.customerName ?? c.tagValue),
      csvEscape(c.stripeCustomerId),
      csvEscape(c.tagValue),
      (c.revenueMicrodollars / 1_000_000).toFixed(2),
      (c.costMicrodollars / 1_000_000).toFixed(2),
      c.marginPercent.toFixed(2),
      (c.marginMicrodollars / 1_000_000).toFixed(2),
      c.healthTier,
    ]);
    const header = ["Customer", "Stripe ID", "Tag Value", "Revenue ($)", "Cost ($)", "Margin (%)", "Margin ($)", "Health Tier"];
    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="margins-${period}.csv"`,
      },
    });
  }

  return NextResponse.json({ data: result });
});

/** RFC 4180: wrap in quotes if value contains comma, quote, or newline. */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
