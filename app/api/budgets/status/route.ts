import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";

import { authenticateApiKey, applyRateLimitHeaders } from "@/lib/auth/with-api-key-auth";
import { getDb } from "@/lib/db/client";
import { budgets } from "@nullspend/db";
import { withRequestContext } from "@/lib/observability";
import { budgetStatusResponseSchema } from "@/lib/validations/budgets";

export const GET = withRequestContext(async (request: Request) => {
  const authResult = await authenticateApiKey(request);
  if (authResult instanceof Response) return authResult;

  const { userId, keyId, rateLimit } = authResult;
  const db = getDb();

  const condition = keyId
    ? or(
        and(eq(budgets.entityType, "user"), eq(budgets.entityId, userId)),
        and(eq(budgets.entityType, "api_key"), eq(budgets.entityId, keyId)),
      )
    : and(eq(budgets.entityType, "user"), eq(budgets.entityId, userId));

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
  }));

  const body = budgetStatusResponseSchema.parse({
    source: "postgres",
    entities,
  });

  return applyRateLimitHeaders(NextResponse.json(body), rateLimit);
});
