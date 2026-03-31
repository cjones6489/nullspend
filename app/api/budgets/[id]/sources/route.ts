import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { budgets } from "@nullspend/db";
import { getSourceBreakdownForEntity } from "@/lib/cost-events/aggregate-cost-events";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";
import { budgetIdParamsSchema } from "@/lib/validations/budgets";
import { sourceBreakdownSchema } from "@/lib/validations/cost-event-summary";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

const querySchema = z.object({
  period: z.enum(["7d", "30d", "90d"]).default("30d"),
});

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "viewer");
    const rawParams = await readRouteParams(params);
    const { id } = budgetIdParamsSchema.parse(rawParams);
    const url = new URL(request.url);
    const { period } = querySchema.parse({
      period: url.searchParams.get("period") ?? undefined,
    });
    const periodDays = parseInt(period, 10);

    const db = getDb();
    const [budget] = await db
      .select({
        entityType: budgets.entityType,
        entityId: budgets.entityId,
      })
      .from(budgets)
      .where(and(eq(budgets.id, id), eq(budgets.orgId, orgId)));

    if (!budget) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Budget not found.", details: null } },
        { status: 404 },
      );
    }

    const sources = await getSourceBreakdownForEntity(
      orgId,
      budget.entityType,
      budget.entityId,
      periodDays,
    );

    return NextResponse.json({
      data: z.array(sourceBreakdownSchema).parse(sources),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
