import { NextResponse } from "next/server";
import { eq, and, isNull, sql } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { ForbiddenError } from "@/lib/auth/errors";
import { getDb } from "@/lib/db/client";
import { apiKeys, budgets } from "@nullspend/db";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { invalidateProxyCache } from "@/lib/proxy-invalidate";
import { budgetIdParamsSchema, budgetResponseSchema } from "@/lib/validations/budgets";

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "admin");
    const rawParams = await readRouteParams(params);
    const { id } = budgetIdParamsSchema.parse(rawParams);
    const db = getDb();

    const { entityType, entityId } = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(budgets)
        .where(and(eq(budgets.id, id), eq(budgets.orgId, orgId)))
        .for("update");

      if (rows.length === 0) {
        throw new NotFoundError("Budget not found.");
      }

      const budget = rows[0];
      await verifyBudgetOwnership(tx, userId, budget.entityType, budget.entityId);

      await tx.delete(budgets).where(eq(budgets.id, id));
      return { entityType: budget.entityType, entityId: budget.entityId };
    });

    invalidateProxyCache({ action: "remove", ownerId: orgId, entityType, entityId }).catch((err) => console.error("[budgets] Proxy cache remove failed:", err));
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: { code: "not_found", message: error.message, details: null } }, { status: 404 });
    }
    return handleRouteError(error);
  }
}

/**
 * POST resets the budget's spend to 0 (manual reset).
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "admin");
    const rawParams = await readRouteParams(params);
    const { id } = budgetIdParamsSchema.parse(rawParams);
    const db = getDb();

    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(budgets)
        .where(and(eq(budgets.id, id), eq(budgets.orgId, orgId)))
        .for("update");

      if (rows.length === 0) {
        throw new NotFoundError("Budget not found.");
      }

      const budget = rows[0];
      await verifyBudgetOwnership(tx, userId, budget.entityType, budget.entityId);

      const [result] = await tx
        .update(budgets)
        .set({
          spendMicrodollars: 0,
          currentPeriodStart: sql`NOW()`,
          updatedAt: sql`NOW()`,
        })
        .where(eq(budgets.id, id))
        .returning();

      return result;
    });

    invalidateProxyCache({
      action: "reset_spend",
      ownerId: orgId,
      entityType: updated.entityType,
      entityId: updated.entityId,
    }).catch((err) => console.error("[budgets] Proxy cache reset_spend failed:", err));

    return NextResponse.json(
      { data: budgetResponseSchema.parse({
        ...updated,
        currentPeriodStart: updated.currentPeriodStart?.toISOString() ?? null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      }) },
    );
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: { code: "not_found", message: error.message, details: null } }, { status: 404 });
    }
    return handleRouteError(error);
  }
}

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

type TxOrDb = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function verifyBudgetOwnership(
  tx: TxOrDb,
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
    const rows = await tx
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
