import { NextResponse } from "next/server";

import { resolveSessionUserId } from "@/lib/auth/session";
import {
  getDailySpend,
  getKeyBreakdown,
  getModelBreakdown,
  getTotals,
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

    const [daily, models, keys, totals] = await Promise.all([
      getDailySpend(userId, periodDays),
      getModelBreakdown(userId, periodDays),
      getKeyBreakdown(userId, periodDays),
      getTotals(userId, periodDays),
    ]);

    const response = costSummaryResponseSchema.parse({
      daily,
      models,
      keys,
      totals: { ...totals, period },
    });

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
