import { NextResponse } from "next/server";

import { CURRENT_VERSION } from "@/lib/api-version";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import {
  getAttributionByKey,
  getAttributionByTag,
} from "@/lib/cost-events/aggregate-cost-events";
import { escapeCSV } from "@/lib/utils/csv";
import { handleRouteError } from "@/lib/utils/http";
import {
  attributionQuerySchema,
  attributionResponseSchema,
} from "@/lib/validations/attribution";

const CSV_HEADERS = [
  "key",
  "key_id",
  "total_cost_microdollars",
  "total_cost_usd",
  "request_count",
  "avg_cost_microdollars",
  "avg_cost_usd",
] as const;

export async function GET(request: Request) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");
    const url = new URL(request.url);

    const {
      groupBy,
      period,
      limit,
      excludeEstimated: excludeEstimatedRaw,
      format,
    } = attributionQuerySchema.parse({
      groupBy: url.searchParams.get("groupBy") ?? undefined,
      period: url.searchParams.get("period") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      excludeEstimated: url.searchParams.get("excludeEstimated") ?? undefined,
      format: url.searchParams.get("format") ?? undefined,
    });

    const periodDays = parseInt(period, 10);
    const opts = excludeEstimatedRaw === "true" ? { excludeEstimated: true } : undefined;

    let groups: Array<{
      key: string;
      keyId: string | null;
      totalCostMicrodollars: number;
      requestCount: number;
      avgCostMicrodollars: number;
    }>;

    if (groupBy === "api_key") {
      const rows = await getAttributionByKey(orgId, periodDays, limit + 1, opts);
      groups = rows.slice(0, limit).map((r) => ({
        key: r.keyName,
        keyId: r.apiKeyId,
        totalCostMicrodollars: r.totalCostMicrodollars,
        requestCount: r.requestCount,
        avgCostMicrodollars:
          r.requestCount > 0 ? Math.round(r.totalCostMicrodollars / r.requestCount) : 0,
      }));
      const hasMore = rows.length > limit;

      if (format === "csv") {
        return buildCSVResponse(groups, groupBy);
      }

      const response = attributionResponseSchema.parse({
        groups,
        period,
        groupBy,
        totalGroups: groups.length,
        hasMore,
      });

      const res = NextResponse.json({ data: response });
      res.headers.set("NullSpend-Version", CURRENT_VERSION);
      return res;
    } else {
      const rows = await getAttributionByTag(orgId, groupBy, periodDays, limit + 1, opts);
      groups = rows.slice(0, limit).map((r) => ({
        key: r.tagValue ?? "(none)",
        keyId: null,
        totalCostMicrodollars: r.totalCostMicrodollars,
        requestCount: r.requestCount,
        avgCostMicrodollars:
          r.requestCount > 0 ? Math.round(r.totalCostMicrodollars / r.requestCount) : 0,
      }));
      const hasMore = rows.length > limit;

      if (format === "csv") {
        return buildCSVResponse(groups, groupBy);
      }

      const response = attributionResponseSchema.parse({
        groups,
        period,
        groupBy,
        totalGroups: groups.length,
        hasMore,
      });

      const res = NextResponse.json({ data: response });
      res.headers.set("NullSpend-Version", CURRENT_VERSION);
      return res;
    }
  } catch (error) {
    return handleRouteError(error);
  }
}

function buildCSVResponse(
  groups: Array<{
    key: string;
    keyId: string | null;
    totalCostMicrodollars: number;
    requestCount: number;
    avgCostMicrodollars: number;
  }>,
  groupBy: string,
) {
  const lines = [CSV_HEADERS.join(",")];
  for (const g of groups) {
    lines.push(
      [
        escapeCSV(g.key),
        escapeCSV(g.keyId ?? ""),
        String(g.totalCostMicrodollars),
        (g.totalCostMicrodollars / 1_000_000).toFixed(6),
        String(g.requestCount),
        String(g.avgCostMicrodollars),
        (g.avgCostMicrodollars / 1_000_000).toFixed(6),
      ].join(","),
    );
  }

  const date = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nullspend-attribution-${groupBy}-${date}.csv"`,
    },
  });
}
