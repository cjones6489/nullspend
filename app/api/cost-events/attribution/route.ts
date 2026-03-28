import { NextResponse } from "next/server";

import { CURRENT_VERSION } from "@/lib/api-version";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import {
  getAttributionByKey,
  getAttributionByTag,
  getTotals,
} from "@/lib/cost-events/aggregate-cost-events";
import { escapeCSV } from "@/lib/utils/csv";
import { handleRouteError } from "@/lib/utils/http";
import {
  attributionQuerySchema,
  attributionResponseSchema,
} from "@/lib/validations/attribution";

function normalizeTagValue(v: string | null): string {
  if (v == null || v === "null") return "(none)";
  return v;
}

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

    const groupsPromise = groupBy === "api_key"
      ? getAttributionByKey(orgId, periodDays, limit + 1, opts)
      : getAttributionByTag(orgId, groupBy, periodDays, limit + 1, opts);

    const [rawRows, totals] = await Promise.all([
      groupsPromise,
      getTotals(orgId, periodDays, opts),
    ]);

    const groups = rawRows.slice(0, limit).map((r) => {
      const isKeyRow = "keyName" in r;
      const cost = r.totalCostMicrodollars;
      const count = r.requestCount;
      return {
        key: isKeyRow
          ? (r as { keyName: string }).keyName
          : normalizeTagValue((r as { tagValue: string | null }).tagValue),
        keyId: isKeyRow ? (r as { apiKeyId: string | null }).apiKeyId : null,
        totalCostMicrodollars: cost,
        requestCount: count,
        avgCostMicrodollars: count > 0 ? Math.round(cost / count) : 0,
      };
    });
    const hasMore = rawRows.length > limit;

    if (format === "csv") {
      return buildCSVResponse(groups, groupBy);
    }

    const response = attributionResponseSchema.parse({
      groups,
      period,
      groupBy,
      totalGroups: groups.length,
      hasMore,
      totals: {
        totalCostMicrodollars: totals.totalCostMicrodollars,
        totalRequests: totals.totalRequests,
      },
    });

    const res = NextResponse.json({ data: response });
    res.headers.set("NullSpend-Version", CURRENT_VERSION);
    return res;
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
