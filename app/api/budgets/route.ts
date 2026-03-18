import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { resolveSessionUserId } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/errors";
import { getDb } from "@/lib/db/client";
import { apiKeys, budgets } from "@nullspend/db";
import { withRequestContext } from "@/lib/observability";
import { getSubscriptionByUserId } from "@/lib/stripe/subscription";
import { getTierForUser, TIERS } from "@/lib/stripe/tiers";
import { readJsonBody } from "@/lib/utils/http";
import {
  createBudgetInputSchema,
  listBudgetsResponseSchema,
} from "@/lib/validations/budgets";

export const GET = withRequestContext(async (_request: Request) => {
  const userId = await resolveSessionUserId();
  const db = getDb();

  const userKeys = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));

  const keyIds = userKeys.map((k) => k.id);

  const rows = await db
    .select()
    .from(budgets)
    .where(
      keyIds.length > 0
        ? or(
            and(eq(budgets.entityType, "user"), eq(budgets.entityId, userId)),
            and(eq(budgets.entityType, "api_key"), inArray(budgets.entityId, keyIds)),
          )
        : and(eq(budgets.entityType, "user"), eq(budgets.entityId, userId)),
    );

  const data = rows.map((row) => ({
    ...row,
    currentPeriodStart: row.currentPeriodStart?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return NextResponse.json(listBudgetsResponseSchema.parse({ data }));
});

export const POST = withRequestContext(async (request: Request) => {
  const userId = await resolveSessionUserId();
  const body = await readJsonBody(request);
  const input = createBudgetInputSchema.parse(body);

  await verifyEntityOwnership(userId, input.entityType, input.entityId);

  // Tier-based spend cap enforcement
  const subscription = await getSubscriptionByUserId(userId);
  const tier = getTierForUser(subscription);
  const spendCap = TIERS[tier].spendCapMicrodollars;

  if (input.maxBudgetMicrodollars > spendCap) {
    return NextResponse.json(
      {
        error: "spend_cap_exceeded",
        message: `Budget amount exceeds your ${TIERS[tier].label} tier spend cap of ${(spendCap / 1_000_000).toLocaleString()} microdollars ($${(spendCap / 1_000_000_000).toLocaleString()}). Upgrade your plan to increase your limit.`,
      },
      { status: 400 },
    );
  }

  const db = getDb();

  // Tier-based budget count enforcement
  const existingForEntity = await db
    .select({ id: budgets.id })
    .from(budgets)
    .where(
      and(
        eq(budgets.entityType, input.entityType),
        eq(budgets.entityId, input.entityId),
      ),
    );

  if (existingForEntity.length === 0) {
    const maxBudgets = TIERS[tier].maxBudgets;

    if (maxBudgets !== Infinity) {
      const userKeys = await db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
      const keyIds = userKeys.map((k) => k.id);

      const allBudgets = await db
        .select({ id: budgets.id })
        .from(budgets)
        .where(
          keyIds.length > 0
            ? or(
                and(
                  eq(budgets.entityType, "user"),
                  eq(budgets.entityId, userId),
                ),
                and(
                  eq(budgets.entityType, "api_key"),
                  inArray(budgets.entityId, keyIds),
                ),
              )
            : and(
                eq(budgets.entityType, "user"),
                eq(budgets.entityId, userId),
              ),
        );

      if (allBudgets.length >= maxBudgets) {
        throw new ForbiddenError(
          "Free tier is limited to 1 budget. Upgrade to Pro for unlimited budgets.",
        );
      }
    }
  }

  const [budget] = await db
    .insert(budgets)
    .values({
      entityType: input.entityType,
      entityId: input.entityId,
      maxBudgetMicrodollars: input.maxBudgetMicrodollars,
      resetInterval: input.resetInterval ?? null,
      ...(input.resetInterval != null && { currentPeriodStart: sql`NOW()` }),
    })
    .onConflictDoUpdate({
      target: [budgets.entityType, budgets.entityId],
      set: {
        maxBudgetMicrodollars: input.maxBudgetMicrodollars,
        resetInterval: input.resetInterval ?? null,
        ...(input.resetInterval != null && { currentPeriodStart: sql`NOW()` }),
        updatedAt: sql`NOW()`,
      },
    })
    .returning();

  return NextResponse.json(
    {
      ...budget,
      currentPeriodStart: budget.currentPeriodStart?.toISOString() ?? null,
      createdAt: budget.createdAt.toISOString(),
      updatedAt: budget.updatedAt.toISOString(),
    },
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
