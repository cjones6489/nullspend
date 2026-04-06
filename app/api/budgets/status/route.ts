import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";

import { CURRENT_VERSION } from "@/lib/api-version";
import { authenticateApiKey, applyRateLimitHeaders } from "@/lib/auth/with-api-key-auth";
import { getDb } from "@/lib/db/client";
import { budgets } from "@nullspend/db";
import { withRequestContext } from "@/lib/observability";
import { budgetStatusResponseSchema } from "@/lib/validations/budgets";

export const GET = withRequestContext(async (request: Request) => {
  const authResult = await authenticateApiKey(request);
  if (authResult instanceof Response) return authResult;

  const { userId, orgId, keyId, rateLimit } = authResult;

  if (!orgId) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Organization context required.", details: null } },
      { status: 403 },
    );
  }

  const db = getDb();

  const entityCondition = keyId
    ? or(
        and(eq(budgets.entityType, "user"), eq(budgets.entityId, userId)),
        and(eq(budgets.entityType, "api_key"), eq(budgets.entityId, keyId)),
      )
    : and(eq(budgets.entityType, "user"), eq(budgets.entityId, userId));

  const condition = and(eq(budgets.orgId, orgId), entityCondition);

  const rows = await db.select().from(budgets).where(condition);

  const entities = rows.map((row) => ({
    entityType: row.entityType,
    entityId: row.entityId,
    limitMicrodollars: row.maxBudgetMicrodollars,
    spendMicrodollars: row.spendMicrodollars,
    remainingMicrodollars: Math.max(0, row.maxBudgetMicrodollars - row.spendMicrodollars),
    policy: row.policy,
    resetInterval: row.resetInterval ?? null,
    currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
    thresholdPercentages: row.thresholdPercentages,
    velocityLimitMicrodollars: row.velocityLimitMicrodollars ?? null,
    velocityWindowSeconds: row.velocityWindowSeconds ?? null,
    velocityCooldownSeconds: row.velocityCooldownSeconds ?? null,
    sessionLimitMicrodollars: row.sessionLimitMicrodollars ?? null,
  }));

  const body = budgetStatusResponseSchema.parse({ entities });

  const response = NextResponse.json(body);
  response.headers.set("NullSpend-Version", CURRENT_VERSION);
  return applyRateLimitHeaders(response, rateLimit);
});
