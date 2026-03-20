import { NextResponse } from "next/server";

import { CURRENT_VERSION } from "@/lib/api-version";
import { resolveSessionUserId } from "@/lib/auth/session";
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
    const userId = await resolveSessionUserId();
    const url = new URL(request.url);
    const { period } = costSummaryQuerySchema.parse({
      period: url.searchParams.get("period") ?? undefined,
    });
    const periodDays = parseInt(period, 10);

    const [daily, models, providers, keys, tools, sources, traces, totals, costBreakdown] = await Promise.all([
      getDailySpend(userId, periodDays),
      getModelBreakdown(userId, periodDays),
      getProviderBreakdown(userId, periodDays),
      getKeyBreakdown(userId, periodDays),
      getToolBreakdown(userId, periodDays),
      getSourceBreakdown(userId, periodDays),
      getTraceBreakdown(userId, periodDays),
      getTotals(userId, periodDays),
      getCostBreakdownTotals(userId, periodDays),
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

    const res = NextResponse.json(response);
    res.headers.set("NullSpend-Version", CURRENT_VERSION);
    return res;
  } catch (error) {
    return handleRouteError(error);
  }
}
