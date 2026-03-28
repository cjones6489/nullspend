import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";

import { CURRENT_VERSION } from "@/lib/api-version";
import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { ForbiddenError } from "@/lib/auth/errors";
import { getDb } from "@/lib/db/client";
import { apiKeys, budgets } from "@nullspend/db";
import { withRequestContext } from "@/lib/observability";
import { resolveOrgTier, assertCountBelowLimit, assertAmountBelowCap } from "@/lib/stripe/feature-gate";
import { readJsonBody } from "@/lib/utils/http";
import {
  budgetResponseSchema,
  createBudgetInputSchema,
  listBudgetsResponseSchema,
} from "@/lib/validations/budgets";
import { invalidateProxyCache } from "@/lib/proxy-invalidate";

export const GET = withRequestContext(async (_request: Request) => {
  const { userId, orgId } = await resolveSessionContext();
  await assertOrgRole(userId, orgId, "viewer");
  const db = getDb();

  const rows = await db
    .select()
    .from(budgets)
    .where(eq(budgets.orgId, orgId));

  const data = rows.map((row) => ({
    ...row,
    currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  const response = NextResponse.json(listBudgetsResponseSchema.parse({ data }));
  response.headers.set("NullSpend-Version", CURRENT_VERSION);
  return response;
});

export const POST = withRequestContext(async (request: Request) => {
  const { userId, orgId } = await resolveSessionContext();
  await assertOrgRole(userId, orgId, "member");
  const body = await readJsonBody(request);
  const input = createBudgetInputSchema.parse(body);

  await verifyEntityOwnership(userId, input.entityType, input.entityId);

  const tierInfo = await resolveOrgTier(orgId);
  assertAmountBelowCap(tierInfo, "spendCapMicrodollars", input.maxBudgetMicrodollars);

  const db = getDb();

  // Tier-based budget count enforcement + insert in a single transaction
  // to prevent race conditions where concurrent requests both pass the count check.
  const [budget] = await db.transaction(async (tx) => {
    const existingForEntity = await tx
      .select({ id: budgets.id })
      .from(budgets)
      .where(
        and(
          eq(budgets.orgId, orgId),
          eq(budgets.entityType, input.entityType),
          eq(budgets.entityId, input.entityId),
        ),
      );

    if (existingForEntity.length === 0) {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(budgets)
        .where(eq(budgets.orgId, orgId));

      assertCountBelowLimit(tierInfo, "maxBudgets", count, "budgets");
    }

    return tx
      .insert(budgets)
      .values({
        userId,
        orgId,
        entityType: input.entityType,
        entityId: input.entityId,
        maxBudgetMicrodollars: input.maxBudgetMicrodollars,
        resetInterval: input.resetInterval ?? null,
        ...(input.resetInterval != null && { currentPeriodStart: sql`NOW()` }),
        ...(input.thresholdPercentages != null && { thresholdPercentages: input.thresholdPercentages }),
        ...(input.velocityLimitMicrodollars !== undefined && { velocityLimitMicrodollars: input.velocityLimitMicrodollars }),
        ...(input.velocityWindowSeconds != null && { velocityWindowSeconds: input.velocityWindowSeconds }),
        ...(input.velocityCooldownSeconds != null && { velocityCooldownSeconds: input.velocityCooldownSeconds }),
        ...(input.velocityLimitMicrodollars === null && { velocityWindowSeconds: 60, velocityCooldownSeconds: 60 }),
        ...(input.sessionLimitMicrodollars !== undefined && { sessionLimitMicrodollars: input.sessionLimitMicrodollars }),
      })
      .onConflictDoUpdate({
        target: [budgets.orgId, budgets.entityType, budgets.entityId],
        set: {
          maxBudgetMicrodollars: input.maxBudgetMicrodollars,
          resetInterval: input.resetInterval ?? null,
          ...(input.resetInterval != null && { currentPeriodStart: sql`NOW()` }),
          ...(input.thresholdPercentages != null && { thresholdPercentages: input.thresholdPercentages }),
          ...(input.velocityLimitMicrodollars !== undefined && { velocityLimitMicrodollars: input.velocityLimitMicrodollars }),
          ...(input.velocityWindowSeconds != null && { velocityWindowSeconds: input.velocityWindowSeconds }),
          ...(input.velocityCooldownSeconds != null && { velocityCooldownSeconds: input.velocityCooldownSeconds }),
          ...(input.velocityLimitMicrodollars === null && { velocityWindowSeconds: 60, velocityCooldownSeconds: 60 }),
          ...(input.sessionLimitMicrodollars !== undefined && { sessionLimitMicrodollars: input.sessionLimitMicrodollars }),
          updatedAt: sql`NOW()`,
        },
      })
      .returning();
  });

  invalidateProxyCache({
    action: "sync",
    ownerId: orgId,
    entityType: input.entityType,
    entityId: input.entityId,
  }).catch((err) => console.error("[budgets] Proxy cache sync failed:", err));

  return NextResponse.json(
    { data: budgetResponseSchema.parse({
      ...budget,
      currentPeriodStart: budget.currentPeriodStart?.toISOString() ?? null,
      createdAt: budget.createdAt.toISOString(),
      updatedAt: budget.updatedAt.toISOString(),
    }) },
    { status: 201 },
  );
});

async function verifyEntityOwnership(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  if (entityType === "user") {
    if (entityId !== userId) {
      throw new ForbiddenError("Cannot manage budgets for other users.");
    }
    return;
  }

  if (entityType === "api_key") {
    const db = getDb();
    const rows = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.id, entityId),
          eq(apiKeys.userId, userId),
          isNull(apiKeys.revokedAt),
        ),
      );

    if (rows.length === 0) {
      throw new ForbiddenError("API key not found or not owned by you.");
    }
    return;
  }

  throw new ForbiddenError(`Unsupported entity type: ${entityType}`);
}
