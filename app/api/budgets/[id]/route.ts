import { NextResponse } from "next/server";
import { eq, and, isNull, sql } from "drizzle-orm";

import { resolveSessionUserId } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/errors";
import { getDb } from "@/lib/db/client";
import { apiKeys, budgets } from "@nullspend/db";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const userId = await resolveSessionUserId();
    const { id } = await readRouteParams(params);
    const db = getDb();

    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(budgets)
        .where(eq(budgets.id, id))
        .for("update");

      if (rows.length === 0) {
        throw new NotFoundError("Budget not found.");
      }

      const budget = rows[0];
      await verifyBudgetOwnership(tx, userId, budget.entityType, budget.entityId);

      await tx.delete(budgets).where(eq(budgets.id, id));
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return handleRouteError(error);
  }
}

/**
 * POST resets the budget's spend to 0 (manual reset).
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const userId = await resolveSessionUserId();
    const { id } = await readRouteParams(params);
    const db = getDb();

    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(budgets)
        .where(eq(budgets.id, id))
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

    return NextResponse.json({
      ...updated,
      currentPeriodStart: updated.currentPeriodStart?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
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
