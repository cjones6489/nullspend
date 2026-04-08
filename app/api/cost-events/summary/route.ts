import { NextResponse } from "next/server";

import { CURRENT_VERSION } from "@/lib/api-version";
import { assertApiKeyOrSession } from "@/lib/auth/dual-auth";
import {
  getCostBreakdownTotals,
  getDailySpend,
  getKeyBreakdown,
  getModelBreakdown,
  getProviderBreakdown,
  getSourceBreakdown,
  getToolBreakdown,
  getTotals,
  getTraceBreakdown,
} from "@/lib/cost-events/aggregate-cost-events";
import { handleRouteError } from "@/lib/utils/http";
import {
  costSummaryQuerySchema,
  costSummaryResponseSchema,
} from "@/lib/validations/cost-event-summary";

export async function GET(request: Request) {
  try {
    // Dual auth: API key (for SDK getCostSummary) or session (for dashboard UI).
    const auth = await assertApiKeyOrSession(request, "viewer");
    if (auth instanceof Response) return auth;
    const { orgId } = auth;
    const url = new URL(request.url);
    const { period, excludeEstimated: excludeEstimatedRaw } = costSummaryQuerySchema.parse({
      period: url.searchParams.get("period") ?? undefined,
      excludeEstimated: url.searchParams.get("excludeEstimated") ?? undefined,
    });
    const periodDays = parseInt(period, 10);
    const opts = excludeEstimatedRaw === "true" ? { excludeEstimated: true } : undefined;

    const [daily, models, providers, keys, tools, sources, traces, totals, costBreakdown] = await Promise.all([
      getDailySpend(orgId, periodDays, opts),
      getModelBreakdown(orgId, periodDays, opts),
      getProviderBreakdown(orgId, periodDays, opts),
      getKeyBreakdown(orgId, periodDays, opts),
      getToolBreakdown(orgId, periodDays, opts),
      getSourceBreakdown(orgId, periodDays, opts),
      getTraceBreakdown(orgId, periodDays, opts),
      getTotals(orgId, periodDays, opts),
      getCostBreakdownTotals(orgId, periodDays, opts),
    ]);

    const response = costSummaryResponseSchema.parse({
      daily,
      models,
      providers,
      keys,
      tools,
      sources,
      traces,
      totals: { ...totals, period },
      costBreakdown,
    });

    const res = NextResponse.json({ data: response });
    res.headers.set("NullSpend-Version", CURRENT_VERSION);
    return res;
  } catch (error) {
    return handleRouteError(error);
  }
}
