import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";

import { rejectAction } from "@/lib/actions/reject-action";
import { resolveSessionContext } from "@/lib/auth/session";
import { assertOrgRole } from "@/lib/auth/org-authorization";
import { getDb } from "@/lib/db/client";
import { actions } from "@nullspend/db";
import {
  actionIdParamsSchema,
  mutateActionResponseSchema,
} from "@/lib/validations/actions";
import { handleRouteError, readRouteParams } from "@/lib/utils/http";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, orgId } = await resolveSessionContext();
    await assertOrgRole(userId, orgId, "admin");
    const params = await readRouteParams(context.params);
    const { id } = actionIdParamsSchema.parse(params);
    const result = await rejectAction(id, { rejectedBy: userId }, orgId);

    // Log budget_increase rejections for observability
    try {
      const db = getDb();
      const [row] = await db
        .select({ actionType: actions.actionType })
        .from(actions)
        .where(and(eq(actions.id, id), eq(actions.orgId, orgId)))
        .limit(1);
      if (row?.actionType === "budget_increase") {
        console.log(`[budget-increase] budget_increase_rejected actionId=${id}`);
      }
    } catch {
      // Best-effort — rejection already committed
    }

    return NextResponse.json({ data: mutateActionResponseSchema.parse(result) });
  } catch (error) {
    return handleRouteError(error);
  }
}
