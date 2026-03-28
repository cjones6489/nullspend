import { NextResponse } from "next/server";

import { CURRENT_VERSION } from "@/lib/api-version";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { resolveSessionContext } from "@/lib/auth/session";
import {
  getAttributionDetailByKey,
  getAttributionDetailByTag,
} from "@/lib/cost-events/aggregate-cost-events";
import { handleRouteError } from "@/lib/utils/http";
import {
  attributionDetailQuerySchema,
  attributionDetailResponseSchema,
} from "@/lib/validations/attribution";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");

    const { key } = await params;

    if (key.includes("/") || key.includes("..")) {
      return NextResponse.json(
        { error: { code: "invalid_key", message: "Invalid key parameter.", details: null } },
        { status: 400 },
      );
    }

    const url = new URL(request.url);
    const {
      groupBy,
      period,
      excludeEstimated: excludeEstimatedRaw,
    } = attributionDetailQuerySchema.parse({
      groupBy: url.searchParams.get("groupBy") ?? undefined,
      period: url.searchParams.get("period") ?? undefined,
      excludeEstimated: url.searchParams.get("excludeEstimated") ?? undefined,
    });

    const periodDays = parseInt(period, 10);
    const opts = excludeEstimatedRaw === "true" ? { excludeEstimated: true } : undefined;
    const decodedKey = decodeURIComponent(key);

    let daily: Array<{ date: string; cost: number; count: number }>;
    let models: Array<{ model: string; cost: number; count: number }>;

    if (groupBy === "api_key") {
      const apiKeyId = decodedKey === "(no key)" ? null : decodedKey;
      const result = await getAttributionDetailByKey(orgId, apiKeyId, periodDays, opts);
      daily = result.daily;
      models = result.models;
    } else {
      const result = await getAttributionDetailByTag(orgId, groupBy, decodedKey, periodDays, opts);
      daily = result.daily;
      models = result.models;
    }

    const totalCostMicrodollars = daily.reduce((sum, d) => sum + d.cost, 0);
    const requestCount = daily.reduce((sum, d) => sum + d.count, 0);
    const avgCostMicrodollars =
      requestCount > 0 ? Math.round(totalCostMicrodollars / requestCount) : 0;

    const response = attributionDetailResponseSchema.parse({
      key: decodedKey,
      totalCostMicrodollars,
      requestCount,
      avgCostMicrodollars,
      daily,
      models,
    });

    const res = NextResponse.json({ data: response });
    res.headers.set("NullSpend-Version", CURRENT_VERSION);
    return res;
  } catch (error) {
    return handleRouteError(error);
  }
}
